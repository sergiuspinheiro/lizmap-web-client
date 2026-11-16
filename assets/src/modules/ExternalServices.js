/**
 * @module modules/ExternalServices.js
 * @name ExternalServices
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import ImageLayer from 'ol/layer/Image.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import ImageWMS from 'ol/source/ImageWMS.js';
import ImageArcGISRest from 'ol/source/ImageArcGISRest.js';
import WMTS, { optionsFromCapabilities } from 'ol/source/WMTS.js';
import XYZ from 'ol/source/XYZ.js';
import VectorSource from 'ol/source/Vector.js';
import WMSCapabilities from 'ol/format/WMSCapabilities.js';
import WMTSCapabilities from 'ol/format/WMTSCapabilities.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import WFS from 'ol/format/WFS.js';
import { bbox as bboxStrategy } from 'ol/loadingstrategy.js';
import { transformExtent } from 'ol/proj.js';

/** Types of external services, in the order of the user interface */
export const SERVICE_TYPES = ['wms', 'wmts', 'wfs', 'ogcapi', 'arcgis', 'xyz', 'geojson'];

/** Maximum number of features requested from vector services */
const MAX_FEATURES = 5000;

/**
 * Add the given parameters to an URL, replacing the existing ones
 * @param {string} url - the base URL
 * @param {object} params - the parameters
 * @returns {string} the URL
 */
export function withParams(url, params) {
    const u = new URL(url, window.location.href);
    // OGC parameters are case insensitive: remove the existing ones
    const keys = Object.keys(params).map(k => k.toLowerCase());
    for (const key of [...u.searchParams.keys()]) {
        if (keys.includes(key.toLowerCase())) {
            u.searchParams.delete(key);
        }
    }
    for (const [key, value] of Object.entries(params)) {
        u.searchParams.set(key, value);
    }
    return u.toString();
}

/**
 * Base URL of a service, without the OGC request parameters
 * @param {string} url - the URL given by the user
 * @returns {string} the base URL
 */
export function serviceBaseUrl(url) {
    const u = new URL(url.trim(), window.location.href);
    for (const key of [...u.searchParams.keys()]) {
        if (['service', 'request', 'version', 'f'].includes(key.toLowerCase())) {
            u.searchParams.delete(key);
        }
    }
    return u.toString().replace(/\?$/, '');
}

/**
 *
 * @param url
 */
function hostname(url) {
    try {
        return new URL(url.trim()).hostname;
    } catch {
        return url;
    }
}

/**
 *
 * @param url
 */
async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.text();
}

/**
 *
 * @param url
 */
async function fetchJson(url) {
    return JSON.parse(await fetchText(url));
}

/**
 * Read the layers offered by a service
 * @param {string} type - one of SERVICE_TYPES
 * @param {string} url - the service URL
 * @returns {Promise<{title: string, layers: Array<{name: string, title: string}>, capabilities: object|null}>}
 *     the service title, its layers and the capabilities needed to create the layers
 */
export async function readService(type, url) {
    const base = serviceBaseUrl(url);
    switch (type) {
        case 'wms': {
            const caps = new WMSCapabilities().read(
                await fetchText(withParams(base, { SERVICE: 'WMS', REQUEST: 'GetCapabilities' }))
            );
            const layers = [];
            const walk = (layer) => {
                if (!layer) {
                    return;
                }
                if (layer.Name) {
                    layers.push({ name: layer.Name, title: layer.Title || layer.Name });
                }
                (layer.Layer || []).forEach(walk);
            };
            walk(caps?.Capability?.Layer);
            return { title: caps?.Service?.Title || base, layers, capabilities: null };
        }
        case 'wmts': {
            const caps = new WMTSCapabilities().read(
                await fetchText(withParams(base, { SERVICE: 'WMTS', REQUEST: 'GetCapabilities' }))
            );
            const layers = (caps?.Contents?.Layer || []).map(l => ({ name: l.Identifier, title: l.Title || l.Identifier }));
            return { title: caps?.ServiceIdentification?.Title || base, layers, capabilities: caps };
        }
        case 'wfs': {
            const xml = new DOMParser().parseFromString(
                await fetchText(withParams(base, { SERVICE: 'WFS', REQUEST: 'GetCapabilities' })),
                'text/xml'
            );
            const layers = Array.from(xml.getElementsByTagNameNS('*', 'FeatureType')).map(ft => {
                const name = ft.getElementsByTagNameNS('*', 'Name')[0]?.textContent?.trim();
                const title = ft.getElementsByTagNameNS('*', 'Title')[0]?.textContent?.trim();
                return { name, title: title || name };
            }).filter(l => l.name);
            const title = xml.getElementsByTagNameNS('*', 'ServiceIdentification')[0]
                ?.getElementsByTagNameNS('*', 'Title')[0]?.textContent?.trim();
            return { title: title || base, layers, capabilities: null };
        }
        case 'ogcapi': {
            const root = base.replace(/\/collections\/?$/, '');
            const data = await fetchJson(withParams(root + '/collections', { f: 'json' }));
            const layers = (data.collections || []).map(c => ({ name: c.id, title: c.title || c.id }));
            return { title: data.title || root, layers, capabilities: null };
        }
        case 'arcgis': {
            const data = await fetchJson(withParams(base, { f: 'json' }));
            const isFeatureServer = /\/FeatureServer\/?$/i.test(base);
            const layers = (data.layers || []).map(l => ({ name: String(l.id), title: l.name || String(l.id) }));
            if (!isFeatureServer) {
            // The whole map service drawn as one image
                layers.unshift({ name: '', title: data.mapName || data.documentInfo?.Title || base });
            }
            return { title: data.mapName || data.serviceDescription || base, layers, capabilities: null };
        }
        case 'xyz':
        case 'geojson':
            return { title: base, layers: [{ name: '', title: hostname(url) }], capabilities: null };
        default:
            throw new Error('Unknown service type ' + type);
    }
}

/**
 * Vector source loading features with a bbox strategy
 * @param {Function} urlFunction - gives the URL of an extent (in the map projection)
 * @param {Function} parse - reads the response text and gives features
 * @returns {VectorSource} the source
 */
function vectorSource(urlFunction, parse) {
    const source = new VectorSource({
        strategy: bboxStrategy,
        loader: async (extent, resolution, projection, success, failure) => {
            try {
                const response = await fetch(urlFunction(extent, projection));
                if (!response.ok) {
                    throw new Error(response.statusText);
                }
                const features = parse(await response.text(), response.headers.get('Content-Type') || '', projection);
                source.addFeatures(features);
                success(features);
            } catch (error) {
                console.error(error);
                source.removeLoadedExtent(extent);
                failure();
            }
        },
    });
    return source;
}

/**
 * Create the OpenLayers layer of a service layer
 * @param {string} type - one of SERVICE_TYPES
 * @param {string} url - the service URL
 * @param {string} name - the layer name, empty for XYZ, GeoJSON or a whole ArcGIS map service
 * @param {object|null} capabilities - the capabilities read by readService, needed for WMTS
 * @param {string} mapProjection - the map projection code
 * @returns {import('ol/layer/Base.js').default} the OpenLayers layer
 */
export function createLayer(type, url, name, capabilities, mapProjection) {
    const base = serviceBaseUrl(url);
    switch (type) {
        case 'wms':
            return new ImageLayer({
                source: new ImageWMS({
                    url: base,
                    params: { LAYERS: name, STYLES: '', FORMAT: 'image/png', TRANSPARENT: true },
                    ratio: 1,
                }),
            });
        case 'wmts': {
            const layerCaps = capabilities?.Contents?.Layer?.find(l => l.Identifier === name);
            const matrixSets = (layerCaps?.TileMatrixSetLink || []).map(link => link.TileMatrixSet);
            const sets = capabilities?.Contents?.TileMatrixSet || [];
            // Prefer a tile matrix set in the map projection, OpenLayers reprojects the others
            const matching = matrixSets.find(id => {
                const crs = sets.find(s => s.Identifier === id)?.SupportedCRS || '';
                return crs.replace(/^urn:ogc:def:crs:EPSG::?/, 'EPSG:').replace(/^.*EPSG:+/, 'EPSG:') === mapProjection;
            });
            const options = optionsFromCapabilities(capabilities, { layer: name, matrixSet: matching || matrixSets[0] });
            if (!options) {
                throw new Error('Unknown WMTS layer ' + name);
            }
            return new TileLayer({ source: new WMTS(options) });
        }
        case 'wfs': {
            const wfsFormat = new WFS();
            const geojson = new GeoJSON();
            return new VectorLayer({
                source: vectorSource(
                    (extent, projection) => withParams(base, {
                        SERVICE: 'WFS',
                        VERSION: '1.1.0',
                        REQUEST: 'GetFeature',
                        TYPENAME: name,
                        OUTPUTFORMAT: 'application/json',
                        SRSNAME: projection.getCode(),
                        MAXFEATURES: MAX_FEATURES,
                        BBOX: extent.join(',') + ',' + projection.getCode(),
                    }),
                    (text, contentType, projection) => {
                        if (contentType.includes('json') || text.trim().startsWith('{')) {
                            return geojson.readFeatures(text, { featureProjection: projection });
                        }
                        // Servers without GeoJSON output answer in GML
                        return wfsFormat.readFeatures(text, { featureProjection: projection });
                    }
                ),
            });
        }
        case 'ogcapi': {
            const root = base.replace(/\/collections\/?$/, '');
            const geojson = new GeoJSON();
            return new VectorLayer({
                source: vectorSource(
                    (extent, projection) => withParams(`${root}/collections/${encodeURIComponent(name)}/items`, {
                        f: 'json',
                        limit: MAX_FEATURES,
                        bbox: transformExtent(extent, projection, 'EPSG:4326').join(','),
                    }),
                    (text, contentType, projection) => geojson.readFeatures(text, {
                        dataProjection: 'EPSG:4326',
                        featureProjection: projection,
                    })
                ),
            });
        }
        case 'arcgis': {
            if (/\/FeatureServer\/?$/i.test(base)) {
                const geojson = new GeoJSON();
                return new VectorLayer({
                    source: vectorSource(
                        (extent, projection) => withParams(`${base.replace(/\/$/, '')}/${name}/query`, {
                            where: '1=1',
                            outFields: '*',
                            f: 'geojson',
                            outSR: '4326',
                            inSR: '4326',
                            geometryType: 'esriGeometryEnvelope',
                            geometry: transformExtent(extent, projection, 'EPSG:4326').join(','),
                            resultRecordCount: MAX_FEATURES,
                        }),
                        (text, contentType, projection) => geojson.readFeatures(text, {
                            dataProjection: 'EPSG:4326',
                            featureProjection: projection,
                        })
                    ),
                });
            }
            return new ImageLayer({
                source: new ImageArcGISRest({
                    url: base,
                    params: name ? { LAYERS: 'show:' + name } : {},
                    ratio: 1,
                }),
            });
        }
        case 'xyz':
            return new TileLayer({ source: new XYZ({ url: url.trim() }) });
        case 'geojson': {
            const source = new VectorSource({ url: url.trim(), format: new GeoJSON() });
            return new VectorLayer({ source });
        }
        default:
            throw new Error('Unknown service type ' + type);
    }
}
