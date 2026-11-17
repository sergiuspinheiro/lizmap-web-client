/**
 * @module modules/FileImport.js
 * @name FileImport
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import GeoJSON from 'ol/format/GeoJSON.js';
import GPX from 'ol/format/GPX.js';
import KML from 'ol/format/KML.js';
import { get as getProjection } from 'ol/proj.js';
import { register } from 'ol/proj/proj4.js';
import proj4 from 'proj4';
import shp from 'shpjs';

/**
 * Coordinate reference systems offered for files without one: those used
 * in Portugal first, then the common ones. Their proj4 definitions let the
 * browser read files without a request to epsg.io.
 */
export const IMPORT_CRS = [
    { group: 'Portugal', code: 'EPSG:3763', label: 'ETRS89 / PT-TM06',
        def: '+proj=tmerc +lat_0=39.6682583333333 +lon_0=-8.13310833333333 +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    { group: 'Portugal', code: 'EPSG:20790', label: 'Datum Lisboa / Hayford-Gauss, coordenadas militares',
        def: '+proj=tmerc +lat_0=39.6666666666667 +lon_0=1 +k=1 +x_0=200000 +y_0=300000 +ellps=intl +towgs84=-304.046,-60.576,103.64,0,0,0,0 +pm=lisbon +units=m +no_defs' },
    { group: 'Portugal', code: 'EPSG:5018', label: 'Datum Lisboa / Hayford-Gauss IGeoE (Lisbon / Portuguese Grid New)',
        def: '+proj=tmerc +lat_0=39.6666666666667 +lon_0=-8.13190611111111 +k=1 +x_0=0 +y_0=0 +ellps=intl +towgs84=-304.046,-60.576,103.64,0,0,0,0 +units=m +no_defs' },
    { group: 'Portugal', code: 'EPSG:27493', label: 'Datum 73 / Hayford-Gauss IPCC',
        def: '+proj=tmerc +lat_0=39.6666666666667 +lon_0=-8.13190611111111 +k=1 +x_0=180.598 +y_0=-86.99 +ellps=intl +towgs84=-223.237,110.193,36.649,0,0,0,0 +units=m +no_defs' },
    { group: 'Portugal', code: 'EPSG:25829', label: 'ETRS89 / UTM 29N',
        def: '+proj=utm +zone=29 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    { group: 'Portugal', code: 'EPSG:32629', label: 'WGS 84 / UTM 29N',
        def: '+proj=utm +zone=29 +datum=WGS84 +units=m +no_defs' },
    { group: 'Portugal', code: 'EPSG:5016', label: 'PTRA08 / UTM 28N (Madeira)',
        def: '+proj=utm +zone=28 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    { group: 'Portugal', code: 'EPSG:5015', label: 'PTRA08 / UTM 26N (Açores central e oriental)',
        def: '+proj=utm +zone=26 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    { group: 'Portugal', code: 'EPSG:5014', label: 'PTRA08 / UTM 25N (Açores ocidental)',
        def: '+proj=utm +zone=25 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    { group: 'World', code: 'EPSG:4326', label: 'WGS 84 (longitude, latitude)', def: '' },
    { group: 'World', code: 'EPSG:4258', label: 'ETRS89 (longitude, latitude)',
        def: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs' },
    { group: 'World', code: 'EPSG:3857', label: 'WGS 84 / Pseudo-Mercator', def: '' },
];

/**
 * Make a projection known by OpenLayers: from the list of IMPORT_CRS, else
 * its proj4 definition is read from epsg.io.
 * @param {string} code - the projection code, like EPSG:3763
 * @returns {Promise<void>}
 */
export async function ensureProjection(code) {
    if (getProjection(code)) {
        return;
    }
    let def = IMPORT_CRS.find(crs => crs.code === code)?.def;
    if (!def) {
        const response = await fetch('https://epsg.io/' + code.split(':')[1] + '.proj4');
        def = response.ok ? (await response.text()).trim() : '';
        if (!def.startsWith('+proj=')) {
            throw new Error(lizDict['catalog.import.crs.unknown'].replace('%s', code));
        }
    }
    proj4.defs(code, def);
    register(proj4);
}

/**
 * Normalize an EPSG code typed by the user: "3763", "epsg:3763"...
 * @param {string} value - the value typed
 * @returns {string|null} the code like EPSG:3763, or null if it is not valid
 */
export function normalizeCrs(value) {
    const match = String(value || '').trim().match(/^(?:EPSG:)?(\d{4,6})$/i);
    return match ? 'EPSG:' + match[1] : null;
}

/**
 * Can all the coordinates of a GeoJSON object be longitudes and latitudes
 * @param {object} geojson - a GeoJSON object
 * @returns {boolean} false if a coordinate is out of the longitude/latitude bounds
 */
export function isGeographic(geojson) {
    const check = coordinates => {
        if (!Array.isArray(coordinates)) {
            return true;
        }
        if (typeof coordinates[0] === 'number') {
            return Math.abs(coordinates[0]) <= 180 && Math.abs(coordinates[1]) <= 90;
        }
        return coordinates.every(check);
    };
    const geometries = [];
    const collect = object => {
        if (!object || typeof object !== 'object') {
            return;
        }
        if (Array.isArray(object)) {
            object.forEach(collect);
        } else if (object.type === 'FeatureCollection') {
            collect(object.features);
        } else if (object.type === 'Feature') {
            collect(object.geometry);
        } else if (object.type === 'GeometryCollection') {
            collect(object.geometries);
        } else if (object.coordinates) {
            geometries.push(object.coordinates);
        }
    };
    collect(geojson);
    return geometries.every(check);
}

/**
 * Code of the CRS named in a GeoJSON object (old GeoJSON specification)
 * @param {object} geojson - a GeoJSON object
 * @returns {string|null} the code like EPSG:3763
 */
function namedCrs(geojson) {
    const name = geojson?.crs?.properties?.name;
    if (!name) {
        return null;
    }
    if (/CRS:?84$/i.test(name)) {
        return 'EPSG:4326';
    }
    const match = String(name).match(/EPSG:{1,2}(\d+)$/i);
    return match ? 'EPSG:' + match[1] : null;
}

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

/** The file has no coordinate reference system: the user must give it */
export class CrsRequiredError extends Error {
    constructor() {
        super('The coordinate reference system of the file is required');
        this.crsRequired = true;
    }
}

/**
 * Convert a file to GeoJSON with GDAL/OGR on the server, for formats
 * that can't be read in the browser (DXF, GeoPackage, CSV, GML...).
 * Features of files with several layers have a `layer` property.
 * @param {Blob} file - the file to import
 * @param {string} mapProjection - the map projection code
 * @param {string} [crs] - the CRS of the layers without one. By default, the map
 *     projection for DXF files. Empty: the server answers an error with
 *     `crsRequired` when the CRS is needed
 * @returns {Promise<import('ol/Feature.js').default[]>} the features in the map projection
 */
export async function importFromServer(file, mapProjection, crs) {
    const params = globalThis.lizUrls.params;
    const formData = new FormData();
    formData.append('repository', params.repository);
    formData.append('project', params.project);
    formData.append('file', file);
    if (crs === undefined) {
        crs = file.name.toLowerCase().endsWith('.dxf') ? mapProjection : '';
    }
    formData.append('crs', crs);
    const response = await fetch(globalThis.lizUrls.convert, { method: 'POST', body: formData });
    if (!response.ok) {
        let message = lizDict['digitizing.import.server.error'];
        if (response.status === 501) {
            message = lizDict['digitizing.import.server.unavailable'];
        } else if (response.status === 401) {
            message = lizDict['digitizing.import.server.login'];
        } else {
            try {
                const data = await response.json();
                if (data.crsRequired) {
                    throw new CrsRequiredError();
                }
                if (data.error) {
                    message += ' (' + data.error + ')';
                }
            } catch (error) {
                if (error instanceof CrsRequiredError) {
                    throw error;
                }
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
 * Read a GeoJSON object in the map projection. Coordinates without CRS that
 * can't be longitudes and latitudes need the CRS given by the user.
 * @param {object} geojson - the GeoJSON object
 * @param {string} mapProjection - the map projection code
 * @param {function(): Promise<string>} getCrs - gives the CRS of the file, asked to the user
 * @returns {Promise<import('ol/Feature.js').default[]>} the features
 */
async function readGeoJson(geojson, mapProjection, getCrs) {
    let dataProjection = namedCrs(geojson);
    if (!dataProjection && !isGeographic(geojson)) {
        dataProjection = await getCrs();
    }
    if (dataProjection) {
        await ensureProjection(dataProjection);
    }
    return new GeoJSON().readFeatures(geojson, {
        dataProjection: dataProjection || 'EPSG:4326',
        featureProjection: mapProjection,
    });
}

/**
 * Read the GeoJSON given by shpjs, one or several shapefiles. Shapefiles
 * with a .prj file are already in longitudes and latitudes.
 * @param {object|object[]} geojson - the shpjs result
 * @param {string} fallbackName - the name of a collection without file name
 * @param {string} mapProjection - the map projection code
 * @param {function(): Promise<string>} getCrs - gives the CRS of the file, asked to the user
 * @returns {Promise<Array<{name: string, features: object[]}>>} the layers
 */
async function readShapefiles(geojson, fallbackName, mapProjection, getCrs) {
    const layers = [];
    for (const collection of Array.isArray(geojson) ? geojson : [geojson]) {
        layers.push({
            name: collection.fileName ? baseName(collection.fileName.split('/').pop()) : fallbackName,
            features: await readGeoJson(collection, mapProjection, getCrs),
        });
    }
    return layers;
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
 *
 * Files without coordinate reference system are read with the CRS given by
 * `askCrs`. Without it, they are reported as errors.
 * @param {File[]} files - the selected files
 * @param {string} mapProjection - the map projection code
 * @param {function(string): Promise<string|null>} [askCrs] - asks the CRS of a file to
 *     the user, given its name, and gives a code like EPSG:3763, or null when cancelled
 * @returns {Promise<{layers: Array<{name: string, features: object[]}>, errors: string[], warnings: string[]}>}
 *     the layers read, the error messages of the files that failed and the warnings
 */
export async function readFiles(files, mapProjection, askCrs = null) {
    const layers = [];
    const errors = [];
    const warnings = [];
    const options = { featureProjection: mapProjection };

    // The CRS of a file is asked once
    const crsGetter = fileName => {
        let crs = null;
        return async () => {
            if (!crs) {
                crs = askCrs ? await askCrs(fileName) : null;
                if (!crs) {
                    throw new Error(lizDict['catalog.import.crs.missing']);
                }
            }
            return crs;
        };
    };
    // Convert on the server, asking the CRS when the server needs it
    const fromServer = async (file, name) => {
        const getCrs = crsGetter(file.name);
        let features;
        try {
            features = await importFromServer(file, mapProjection, '');
        } catch (error) {
            if (!error.crsRequired) {
                throw error;
            }
            features = await importFromServer(file, mapProjection, await getCrs());
        }
        return splitByLayer(features, name);
    };

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
            if (!parts.dbf) {
                warnings.push(name + '.shp: ' + lizDict['catalog.import.shp.nodbf']);
            }
            const geojson = await shp({
                shp: await parts.shp.arrayBuffer(),
                dbf: parts.dbf ? await parts.dbf.arrayBuffer() : undefined,
                prj: parts.prj ? await parts.prj.text() : undefined,
                cpg: parts.cpg ? await parts.cpg.text() : undefined,
            });
            layers.push(...await readShapefiles(geojson, name, mapProjection, crsGetter(name + '.shp')));
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
                const geojson = JSON.parse(await file.text());
                layers.push({ name, features: await readGeoJson(geojson, mapProjection, crsGetter(file.name)) });
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
                    layers.push(...await readShapefiles(geojson, name, mapProjection, crsGetter(file.name)));
                } else {
                    layers.push(...await fromServer(file, name));
                }
            } else if (SERVER_IMPORT_EXTENSIONS.includes(ext)) {
                layers.push(...await fromServer(file, name));
            } else {
                throw new Error(lizDict['catalog.import.format']);
            }
        } catch (error) {
            errors.push(file.name + ': ' + error.message);
        }
    }
    return { layers: layers.filter(layer => layer.features.length), errors, warnings };
}
