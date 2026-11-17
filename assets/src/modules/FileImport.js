/**
 * @module modules/FileImport.js
 * @name FileImport
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import GeoJSON from 'ol/format/GeoJSON.js';
import GPX from 'ol/format/GPX.js';
import KML from 'ol/format/KML.js';
import shp from 'shpjs';

/** Formats converted on the server with GDAL/OGR */
export const SERVER_IMPORT_EXTENSIONS = ['dxf', 'gpkg', 'gml', 'csv', 'kmz', 'sqlite', 'geojsonl', 'geojsons'];

/** Parts of a shapefile, selected together */
const SHAPEFILE_PARTS = ['shp', 'dbf', 'shx', 'prj', 'cpg'];

/** Formats read in the browser */
const BROWSER_EXTENSIONS = ['geojson', 'json', 'kml', 'gpx', 'zip'];

/** Extensions accepted by the file import, for the file input */
export const IMPORT_ACCEPT = [...BROWSER_EXTENSIONS, ...SHAPEFILE_PARTS, ...SERVER_IMPORT_EXTENSIONS]
    .map(ext => '.' + ext).join(',');

/**
 * Extension of a file name
 * @param {string} name - the file name
 * @returns {string} the extension in lower case
 */
function extensionOf(name) {
    return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}

/**
 * Name of a file without its extension
 * @param {string} name - the file name
 * @returns {string} the base name
 */
function baseName(name) {
    return name.includes('.') ? name.substring(0, name.lastIndexOf('.')) : name;
}

/**
 * Convert a file to GeoJSON with GDAL/OGR on the server, for formats
 * that can't be read in the browser (DXF, GeoPackage, CSV, GML...).
 * Features of files with several layers have a `layer` property.
 * @param {Blob} file - the file to import
 * @param {string} mapProjection - the map projection code
 * @returns {Promise<import('ol/Feature.js').default[]>} the features in the map projection
 */
export async function importFromServer(file, mapProjection) {
    const params = globalThis.lizUrls.params;
    const formData = new FormData();
    formData.append('repository', params.repository);
    formData.append('project', params.project);
    formData.append('file', file);
    // CSV without CRS are read in WGS 84 and DXF in the map CRS
    formData.append('crs', file.name.toLowerCase().endsWith('.dxf') ? mapProjection : '');
    const response = await fetch(globalThis.lizUrls.convert, { method: 'POST', body: formData });
    if (!response.ok) {
        let message = lizDict['digitizing.import.server.error'];
        if (response.status === 501) {
            message = lizDict['digitizing.import.server.unavailable'];
        } else if (response.status === 401) {
            message = lizDict['digitizing.import.server.login'];
        } else {
            try {
                const detail = (await response.json()).error;
                if (detail) {
                    message += ' (' + detail + ')';
                }
            } catch {
                // Not a JSON response
            }
        }
        throw new Error(message);
    }
    const features = new GeoJSON().readFeatures(await response.json(), {
        dataProjection: 'EPSG:4326',
        featureProjection: mapProjection,
    });
    if (features.length === 0) {
        throw new Error(lizDict['digitizing.import.server.empty']);
    }
    return features;
}

/**
 * Read the GeoJSON given by shpjs, one or several shapefiles
 * @param {object|object[]} geojson - the shpjs result
 * @param {string} fallbackName - the name of a collection without file name
 * @param {string} mapProjection - the map projection code
 * @returns {Array<{name: string, features: object[]}>} the layers
 */
function readShapefiles(geojson, fallbackName, mapProjection) {
    return (Array.isArray(geojson) ? geojson : [geojson]).map(collection => ({
        name: collection.fileName ? baseName(collection.fileName.split('/').pop()) : fallbackName,
        features: new GeoJSON().readFeatures(collection, { featureProjection: mapProjection }),
    }));
}

/**
 * Split features converted on the server by their source layer
 * @param {object[]} features - the features
 * @param {string} name - the file base name
 * @returns {Array<{name: string, features: object[]}>} the layers
 */
function splitByLayer(features, name) {
    const layers = new Map();
    for (const feature of features) {
        const layer = feature.get('layer');
        const key = layer === undefined ? name : name + ' - ' + layer;
        if (!layers.has(key)) {
            layers.set(key, []);
        }
        layers.get(key).push(feature);
    }
    return [...layers].map(([layerName, layerFeatures]) => ({ name: layerName, features: layerFeatures }));
}

/**
 * Read the features of files selected by the user: GeoJSON, KML, GPX and
 * shapefiles (zipped, or their parts selected together) are read in the
 * browser, the other formats are converted on the server.
 * @param {File[]} files - the selected files
 * @param {string} mapProjection - the map projection code
 * @returns {Promise<{layers: Array<{name: string, features: object[]}>, errors: string[]}>}
 *     the layers read and the error messages of the files that failed
 */
export async function readFiles(files, mapProjection) {
    const layers = [];
    const errors = [];
    const options = { featureProjection: mapProjection };

    // Shapefile parts grouped by base name
    const shapefiles = new Map();
    for (const file of files) {
        const ext = extensionOf(file.name);
        if (SHAPEFILE_PARTS.includes(ext)) {
            const name = baseName(file.name);
            if (!shapefiles.has(name)) {
                shapefiles.set(name, {});
            }
            shapefiles.get(name)[ext] = file;
        }
    }
    for (const [name, parts] of shapefiles) {
        try {
            if (!parts.shp) {
                throw new Error(lizDict['catalog.import.shp.missing']);
            }
            const geojson = await shp({
                shp: await parts.shp.arrayBuffer(),
                dbf: parts.dbf ? await parts.dbf.arrayBuffer() : undefined,
                prj: parts.prj ? await parts.prj.text() : undefined,
                cpg: parts.cpg ? await parts.cpg.text() : undefined,
            });
            layers.push(...readShapefiles(geojson, name, mapProjection));
        } catch (error) {
            errors.push(name + '.shp: ' + error.message);
        }
    }

    for (const file of files) {
        const ext = extensionOf(file.name);
        const name = baseName(file.name);
        if (SHAPEFILE_PARTS.includes(ext)) {
            continue;
        }
        try {
            if (['json', 'geojson'].includes(ext)) {
                layers.push({ name, features: new GeoJSON().readFeatures(await file.text(), options) });
            } else if (ext === 'gpx') {
                layers.push({ name, features: new GPX().readFeatures(await file.text(), options) });
            } else if (ext === 'kml') {
                layers.push({ name, features: new KML({ extractStyles: false }).readFeatures(await file.text(), options) });
            } else if (ext === 'zip') {
                // Zipped shapefiles, else other zipped formats converted on the server
                let geojson = null;
                try {
                    geojson = await shp(await file.arrayBuffer());
                } catch (error) {
                    console.info(error);
                }
                if (geojson) {
                    layers.push(...readShapefiles(geojson, name, mapProjection));
                } else {
                    layers.push(...splitByLayer(await importFromServer(file, mapProjection), name));
                }
            } else if (SERVER_IMPORT_EXTENSIONS.includes(ext)) {
                layers.push(...splitByLayer(await importFromServer(file, mapProjection), name));
            } else {
                throw new Error(lizDict['catalog.import.format']);
            }
        } catch (error) {
            errors.push(file.name + ': ' + error.message);
        }
    }
    return { layers: layers.filter(layer => layer.features.length), errors };
}
