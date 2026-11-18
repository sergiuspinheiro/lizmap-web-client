/**
 * @module modules/LabelOverlay.js
 * @name LabelOverlay
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { transformExtent } from 'ol/proj.js';
import { bbox as bboxStrategy } from 'ol/loadingstrategy.js';
import { labelStyle } from './ImportStyle.js';

/** Maximum number of features read for an extent */
export const MAX_LABEL_FEATURES = 1000;

/**
 * WFS GetFeature URL of the features of an extent
 * @param {string} serviceUrl - the Lizmap service URL of the project
 * @param {object} params - the extra parameters, like repository and project
 * @param {string} typeName - the WFS type name of the layer
 * @param {number[]} [extent] - the extent in EPSG:4326, none to read one feature
 * @returns {string} the URL
 */
export function labelFeaturesUrl(serviceUrl, params, typeName, extent) {
    const url = new URL(serviceUrl, globalThis.location?.href || 'http://localhost/');
    const all = {
        ...params,
        SERVICE: 'WFS', VERSION: '1.0.0', REQUEST: 'GetFeature', TYPENAME: typeName,
        OUTPUTFORMAT: 'GeoJSON', SRSNAME: 'EPSG:4326',
        MAXFEATURES: extent ? String(MAX_LABEL_FEATURES) : '1',
        ...(extent ? { BBOX: extent.join(',') } : {}),
    };
    for (const [key, value] of Object.entries(all)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

/**
 * Layer drawing the labels of a layer of QGIS Server, from the features read
 * with the WFS of its project (the user rights and filters apply)
 * @param {string} serviceUrl - the Lizmap service URL of the project
 * @param {object} params - the extra parameters, like repository and project
 * @param {string} typeName - the WFS type name of the layer
 * @returns {VectorLayer} the layer, to style with setLabelOverlayStyle
 */
export function createLabelOverlay(serviceUrl, params, typeName) {
    const format = new GeoJSON();
    const source = new VectorSource({
        strategy: bboxStrategy,
        loader: async (extent, resolution, projection, success, failure) => {
            try {
                const response = await fetch(labelFeaturesUrl(
                    serviceUrl, params, typeName, transformExtent(extent, projection, 'EPSG:4326')
                ));
                if (!response.ok) {
                    throw new Error(response.statusText);
                }
                const features = format.readFeatures(await response.json(), {
                    dataProjection: 'EPSG:4326', featureProjection: projection,
                });
                source.addFeatures(features);
                success(features);
            } catch (error) {
                console.error(error);
                source.removeLoadedExtent(extent);
                failure();
            }
        },
    });
    return new VectorLayer({ source, declutter: true, zIndex: 1000 });
}

/**
 * Style the labels of an overlay
 * @param {VectorLayer} overlay - the overlay
 * @param {import('./ImportStyle.js').LabelSpec} label - the label settings
 */
export function setLabelOverlayStyle(overlay, label) {
    overlay.setStyle(feature => labelStyle(feature, label));
}

/**
 * Fields of a layer, read from one feature
 * @param {string} serviceUrl - the Lizmap service URL of the project
 * @param {object} params - the extra parameters, like repository and project
 * @param {string} typeName - the WFS type name of the layer
 * @returns {Promise<string[]>} the fields
 */
export async function labelFields(serviceUrl, params, typeName) {
    try {
        const response = await fetch(labelFeaturesUrl(serviceUrl, params, typeName));
        const data = response.ok ? await response.json() : null;
        const properties = data?.features?.[0]?.properties || {};
        return Object.keys(properties).filter(key => properties[key] === null || typeof properties[key] !== 'object');
    } catch {
        return [];
    }
}
