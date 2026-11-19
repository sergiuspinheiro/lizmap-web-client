/**
 * @module modules/SnapTargets.js
 * @name SnapTargets
 * @copyright 2026 3Liz
 * @license MPL-2.0
 * @description Shared helpers for the snapping of the edition and of the draw tools:
 * the list of the layers the user can snap to, the WFS request of their features,
 * the snap modes and the points computed from the geometries (vertices,
 * segment midpoints, intersections).
 */

import WFS from './WFS.js';

/**
 * Snap modes
 * @type {string[]}
 */
export const SnapModes = ['vertices', 'segments', 'midpoints', 'intersections'];

/**
 * Maximum number of segments used to compute the intersections
 * @type {number}
 */
const MAX_SEGMENTS = 200000;

/**
 * Maximum number of intersection points
 * @type {number}
 */
const MAX_INTERSECTIONS = 50000;

/**
 * Key of the local storage for the snapping settings of a tool
 * @param {string} tool - 'draw' or 'edition_<layerId>'
 * @returns {string} the key
 */
export function snapStorageKey(tool) {
    const params = globalThis['lizUrls']?.params || {};
    return `${params.repository}_${params.project}_snap_${tool}`;
}

/**
 * Read the saved snapping settings of a tool
 * @param {string} tool - 'draw' or 'edition_<layerId>'
 * @returns {object|null} {layers, modes, tolerance} or null
 */
export function readSnapSettings(tool) {
    try {
        const value = localStorage.getItem(snapStorageKey(tool));
        if (!value) {
            return null;
        }
        const settings = JSON.parse(value);
        if (!settings || typeof settings !== 'object') {
            return null;
        }
        return settings;
    } catch {
        return null;
    }
}

/**
 * Save the snapping settings of a tool
 * @param {string} tool     - 'draw' or 'edition_<layerId>'
 * @param {object} settings - {layers, modes, tolerance}
 */
export function saveSnapSettings(tool, settings) {
    try {
        localStorage.setItem(snapStorageKey(tool), JSON.stringify(settings));
    } catch {
        // storage full or blocked: settings are kept only for this page
    }
}

/**
 * The layers with a geometry published in WFS, the user can snap to
 * @param {object} lizmap3 - The old lizmap object
 * @param {object[]} featureTypes - WFS feature types (initialConfig.vectorLayerFeatureTypeList)
 * @returns {Array<{id: string, name: string, title: string}>} the layers sorted by title
 */
export function snapCandidateLayers(lizmap3, featureTypes) {
    const layers = [];
    const ids = new Set();
    const config = lizmap3.config;
    for (const featureType of (featureTypes || [])) {
        const name = lizmap3.getNameByTypeName(featureType.Name);
        if (!name || !(name in config.layers)) {
            continue;
        }
        const layerConfig = config.layers[name];
        if (['none', 'unknown', undefined, ''].includes(layerConfig.geometryType)) {
            continue;
        }
        if (!layerConfig.id || ids.has(layerConfig.id)) {
            continue;
        }
        ids.add(layerConfig.id);
        layers.push({
            id: layerConfig.id,
            name: name,
            title: layerConfig.title || name,
        });
    }
    layers.sort((a, b) => a.title.localeCompare(b.title));
    return layers;
}

/**
 * Request the features of a layer in WFS, in the map projection and in the map extent
 * @param {object} lizmap3 - The old lizmap object
 * @param {string} layerId - The layer id
 * @param {object} options - {projection: string, extent: number[]|null, maxFeatures: number}
 * @returns {Promise<object[]>} the GeoJSON features
 */
export async function fetchSnapFeatures(lizmap3, layerId, options) {
    const layerConfigById = lizmap3.getLayerConfigById(layerId);
    if (!layerConfigById || !layerConfigById[0]) {
        return [];
    }
    const layerName = layerConfigById[0];
    const layerConf = lizmap3.config.layers[layerName];
    if (!layerConf) {
        return [];
    }

    // Same typename as getVectorLayerWfsUrl
    let typeName = layerName.split(' ').join('_');
    if (layerConf['shortname']) {
        typeName = layerConf['shortname'];
    } else if (layerConf['typename']) {
        typeName = layerConf['typename'];
    }

    // QGIS Server reprojects to the map projection
    const wfsOptions = {
        VERSION: '1.1.0',
        TYPENAME: typeName,
        SRSNAME: options.projection,
        MAXFEATURES: options.maxFeatures || 1000,
    };

    // Layer filter (e.g. login-based filter)
    const layerFilter = layerConf?.['request_params']?.['filter'];
    if (layerFilter) {
        wfsOptions['EXP_FILTER'] = layerFilter.replace(layerName + ':', '');
    }

    if (options.extent) {
        wfsOptions['BBOX'] = options.extent.join(',') + ',' + options.projection;
    }

    const data = await (new WFS()).getFeature(wfsOptions);
    if (!data || !Array.isArray(data.features)) {
        throw new Error('No valid FeatureCollection for layer ' + layerName);
    }
    return data.features;
}

/**
 * Add the lines (as coordinate arrays) of a GeoJSON geometry
 * @param {object} geometry - GeoJSON geometry
 * @param {Array<number[][]>} lines - lines to fill
 * @param {Array<number[]>} points - single points to fill
 */
function collectLines(geometry, lines, points) {
    if (!geometry) {
        return;
    }
    switch (geometry.type) {
        case 'Point':
            points.push(geometry.coordinates);
            break;
        case 'MultiPoint':
            points.push(...geometry.coordinates);
            break;
        case 'LineString':
            lines.push(geometry.coordinates);
            break;
        case 'MultiLineString':
        case 'Polygon':
            lines.push(...geometry.coordinates);
            break;
        case 'MultiPolygon':
            for (const polygon of geometry.coordinates) {
                lines.push(...polygon);
            }
            break;
        case 'GeometryCollection':
            for (const geom of (geometry.geometries || [])) {
                collectLines(geom, lines, points);
            }
            break;
    }
}

/**
 * Intersection point of two segments, if any
 * @param {number[]} a - first point of segment 1
 * @param {number[]} b - second point of segment 1
 * @param {number[]} c - first point of segment 2
 * @param {number[]} d - second point of segment 2
 * @returns {number[]|null} the point, or null when the segments do not cross
 * or only touch at a vertex they share
 */
function segmentIntersection(a, b, c, d) {
    const rx = b[0] - a[0];
    const ry = b[1] - a[1];
    const sx = d[0] - c[0];
    const sy = d[1] - c[1];
    const denom = rx * sy - ry * sx;
    const scale = Math.abs(rx) + Math.abs(ry) + Math.abs(sx) + Math.abs(sy);
    // parallel or collinear
    if (Math.abs(denom) <= 1e-12 * scale * scale) {
        return null;
    }
    const qx = c[0] - a[0];
    const qy = c[1] - a[1];
    const t = (qx * sy - qy * sx) / denom;
    const u = (qx * ry - qy * rx) / denom;
    const eps = 1e-9;
    if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) {
        return null;
    }
    // Both ends: the segments only share a vertex, already a vertex snap point
    const tEnd = t < eps || t > 1 - eps;
    const uEnd = u < eps || u > 1 - eps;
    if (tEnd && uEnd) {
        return null;
    }
    return [a[0] + t * rx, a[1] + t * ry];
}

/**
 * Compute the snap points of GeoJSON features
 * @param {object[]} features - GeoJSON features (map projection)
 * @param {object}   modes    - {vertices: boolean, midpoints: boolean, intersections: boolean}
 * @returns {{vertices: number[][], midpoints: number[][], intersections: number[][]}} the points
 */
export function computeSnapPoints(features, modes) {
    const result = {vertices: [], midpoints: [], intersections: []};
    const lines = [];
    const points = [];
    for (const feature of features) {
        collectLines(feature?.geometry, lines, points);
    }

    if (modes.vertices) {
        result.vertices.push(...points);
        for (const line of lines) {
            result.vertices.push(...line);
        }
    }

    if (!modes.midpoints && !modes.intersections) {
        return result;
    }

    // Segments
    const segments = [];
    for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
            const a = line[i - 1];
            const b = line[i];
            if (a[0] === b[0] && a[1] === b[1]) {
                continue;
            }
            segments.push([a, b]);
        }
    }

    if (modes.midpoints) {
        for (const [a, b] of segments) {
            result.midpoints.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        }
    }

    if (modes.intersections && segments.length > 1 && segments.length <= MAX_SEGMENTS) {
        result.intersections = computeIntersections(segments);
    }

    return result;
}

/**
 * Intersections of segments, with a grid index
 * @param {Array<number[][]>} segments - the segments
 * @returns {number[][]} the intersection points
 */
function computeIntersections(segments) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [a, b] of segments) {
        minX = Math.min(minX, a[0], b[0]);
        minY = Math.min(minY, a[1], b[1]);
        maxX = Math.max(maxX, a[0], b[0]);
        maxY = Math.max(maxY, a[1], b[1]);
    }
    const width = Math.max(maxX - minX, 1e-9);
    const height = Math.max(maxY - minY, 1e-9);
    const cellsPerSide = Math.max(1, Math.min(512, Math.ceil(Math.sqrt(segments.length))));
    const cellW = width / cellsPerSide;
    const cellH = height / cellsPerSide;
    const cellX = x => Math.min(cellsPerSide - 1, Math.max(0, Math.floor((x - minX) / cellW)));
    const cellY = y => Math.min(cellsPerSide - 1, Math.max(0, Math.floor((y - minY) / cellH)));

    const grid = new Map();
    segments.forEach(([a, b], index) => {
        const x0 = cellX(Math.min(a[0], b[0]));
        const x1 = cellX(Math.max(a[0], b[0]));
        const y0 = cellY(Math.min(a[1], b[1]));
        const y1 = cellY(Math.max(a[1], b[1]));
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                const key = x * cellsPerSide + y;
                let cell = grid.get(key);
                if (!cell) {
                    cell = [];
                    grid.set(key, cell);
                }
                cell.push(index);
            }
        }
    });

    const result = [];
    const seen = new Set();
    for (const [key, cell] of grid) {
        const cx = Math.floor(key / cellsPerSide);
        const cy = key % cellsPerSide;
        for (let i = 0; i < cell.length; i++) {
            const [a, b] = segments[cell[i]];
            for (let j = i + 1; j < cell.length; j++) {
                const [c, d] = segments[cell[j]];
                // quick bounding box test
                if (Math.max(a[0], b[0]) < Math.min(c[0], d[0])
                    || Math.max(c[0], d[0]) < Math.min(a[0], b[0])
                    || Math.max(a[1], b[1]) < Math.min(c[1], d[1])
                    || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) {
                    continue;
                }
                const point = segmentIntersection(a, b, c, d);
                if (!point) {
                    continue;
                }
                // count the point only in the cell where it lies, so a pair of segments
                // sharing several cells gives one point
                if (cellX(point[0]) !== cx || cellY(point[1]) !== cy) {
                    continue;
                }
                // several segments crossing at the same place
                const pointKey = point[0].toFixed(6) + ',' + point[1].toFixed(6);
                if (seen.has(pointKey)) {
                    continue;
                }
                seen.add(pointKey);
                result.push(point);
                if (result.length >= MAX_INTERSECTIONS) {
                    return result;
                }
            }
        }
    }
    return result;
}
