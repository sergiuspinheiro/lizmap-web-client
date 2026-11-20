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
import GeoJSON from 'ol/format/GeoJSON.js';

/**
 * Snap modes; tracing follows the lines between two snapped vertices
 * @type {string[]}
 */
export const SnapModes = ['vertices', 'segments', 'midpoints', 'intersections', 'tracing'];

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

/**
 * Position of a point on a line: index of the segment, ratio on it, and distance
 * @param {number[][]} line  - the line coordinates
 * @param {number[]}   point - the point
 * @returns {{index: number, t: number, distance: number}} the closest position
 */
function locateOnLine(line, point) {
    let best = {index: -1, t: 0, distance: Infinity};
    for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        let t = 0;
        if (len2 > 0) {
            t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
        }
        const x = a[0] + t * dx;
        const y = a[1] + t * dy;
        const distance = Math.hypot(point[0] - x, point[1] - y);
        if (distance < best.distance) {
            best = {index: i - 1, t: t, distance: distance};
        }
    }
    return best;
}

/**
 * Length of a path
 * @param {number[][]} path - coordinates
 * @returns {number} the length
 */
function pathLength(path) {
    let length = 0;
    for (let i = 1; i < path.length; i++) {
        length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    }
    return length;
}

/**
 * Lines of the features used by the tracing
 * @type {WeakMap<object[], Array<{line: number[][], extent: number[]}>>}
 */
const traceLinesCache = new WeakMap();

/**
 * Tracing: the vertices of a line (or ring) between two points lying on it, like the tracing of QGIS.
 *
 * The line is the one where both points are the closest (within the tolerance). For a ring
 * (polygon boundary) the shorter way around is used.
 * @param {object[]} features  - GeoJSON features (map projection)
 * @param {number[]} start     - the first point
 * @param {number[]} end       - the second point
 * @param {number}   tolerance - maximum distance of the points to the line, in map units
 * @returns {number[][]} the vertices to insert between start and end (empty when no line links them)
 */
export function tracePath(features, start, end, tolerance) {
    // The lines and their extents are kept for the same features (called on each mouse move)
    let lines = traceLinesCache.get(features);
    if (!lines) {
        const coordinates = [];
        for (const feature of features) {
            collectLines(feature?.geometry, coordinates, []);
        }
        lines = coordinates.filter(line => line.length >= 2).map(line => {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const [x, y] of line) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
            return {line, extent: [minX, minY, maxX, maxY]};
        });
        traceLinesCache.set(features, lines);
    }
    const inExtent = (extent, p) => p[0] >= extent[0] - tolerance && p[0] <= extent[2] + tolerance
        && p[1] >= extent[1] - tolerance && p[1] <= extent[3] + tolerance;

    let best = null;
    for (const {line, extent} of lines) {
        if (!inExtent(extent, start) || !inExtent(extent, end)) {
            continue;
        }
        const a = locateOnLine(line, start);
        if (a.distance > tolerance) {
            continue;
        }
        const b = locateOnLine(line, end);
        if (b.distance > tolerance) {
            continue;
        }
        const score = a.distance + b.distance;
        if (!best || score < best.score) {
            best = {line, a, b, score};
        }
    }
    if (!best) {
        return [];
    }

    const {line, a, b} = best;
    const pos = (p) => p.index + p.t;
    // vertices of the line strictly between two positions, going forward
    const forward = (from, to) => {
        const result = [];
        for (let i = Math.max(0, Math.ceil(from)); i <= Math.min(line.length - 1, Math.floor(to)); i++) {
            if (i > from + 1e-9 && i < to - 1e-9) {
                result.push(line[i].slice(0, 2));
            }
        }
        return result;
    };

    const first = line[0];
    const last = line[line.length - 1];
    const isRing = line.length > 3 && first[0] === last[0] && first[1] === last[1];

    let path;
    if (pos(a) <= pos(b)) {
        path = forward(pos(a), pos(b));
    } else {
        path = forward(pos(b), pos(a)).reverse();
    }

    if (isRing) {
        // the other way around the ring
        const n = line.length - 1; // number of distinct vertices
        let other;
        if (pos(a) <= pos(b)) {
            // backward from a to vertex 0, then from the end of the ring back to b
            other = forward(0, pos(a)).reverse();
            if (pos(a) > 1e-9) {
                other.push(line[0].slice(0, 2));
            }
            other = other.concat(forward(pos(b), n).reverse());
        } else {
            other = forward(pos(a), n);
            if (pos(b) > 1e-9) {
                other.push(line[0].slice(0, 2));
            }
            other = other.concat(forward(0, pos(b)));
        }
        // remove duplicates of the closing vertex
        other = other.filter((p, i) => i === 0 || p[0] !== other[i - 1][0] || p[1] !== other[i - 1][1]);
        if (pathLength([start, ...other, end]) < pathLength([start, ...path, end])) {
            path = other;
        }
    }

    // no vertex identical to the start or the end
    return path.filter(p => !(p[0] === start[0] && p[1] === start[1]) && !(p[0] === end[0] && p[1] === end[1]));
}

/**
 * Prefix of the ids of the external layers (loaded files, external services)
 * @type {string}
 */
export const EXTERNAL_PREFIX = 'ext:';

/**
 * The vector layers added to the map outside the project: loaded files, external
 * services with geometries (WFS, OGC API, ArcGIS feature services, GeoJSON), catalog layers
 * @param {object} rootMapGroup - root map group state
 * @returns {Array<{id: string, title: string, state: object}>} the layers
 */
export function externalSnapLayers(rootMapGroup) {
    const layers = [];
    const groups = rootMapGroup?.children || [];
    for (const group of groups) {
        if (!group || group.type !== 'ext-group') {
            continue;
        }
        for (const layer of (group.children || [])) {
            const source = layer?.olLayer?.getSource?.();
            if (!source || typeof source.forEachFeatureInExtent !== 'function') {
                continue;
            }
            const groupTitle = group.wmsTitle && group.wmsTitle !== group.name ? group.wmsTitle : '';
            const title = layer.wmsTitle || layer.name;
            layers.push({
                id: EXTERNAL_PREFIX + group.name + '/' + layer.name,
                title: groupTitle && groupTitle !== title ? groupTitle + ' / ' + title : title,
                state: layer,
            });
        }
    }
    return layers;
}

/**
 * The features of an external vector layer in an extent, as GeoJSON in the map projection
 * @param {object}   layerState - the external layer state (with olLayer)
 * @param {number[]} extent     - the extent
 * @param {number}   [maxFeatures] - maximum number of features
 * @returns {object[]} the GeoJSON features
 */
export function externalSnapFeatures(layerState, extent, maxFeatures = 5000) {
    const source = layerState?.olLayer?.getSource?.();
    if (!source) {
        return [];
    }
    const features = [];
    const collect = (feature) => {
        if (features.length >= maxFeatures) {
            return true;
        }
        const geometry = feature.getGeometry();
        if (geometry && geometry.getType() !== 'Circle') {
            features.push(feature);
        }
        return undefined;
    };
    if (extent) {
        source.forEachFeatureInExtent(extent, collect);
    } else {
        source.forEachFeature(collect);
    }
    if (features.length === 0) {
        return [];
    }
    return new GeoJSON().writeFeaturesObject(features).features;
}
