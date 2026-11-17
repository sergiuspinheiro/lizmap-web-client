/**
 * @module modules/ImportStyle.js
 * @name ImportStyle
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { Circle, Fill, Stroke, Style, Text } from 'ol/style.js';

/** Classify by the geometry type instead of a field */
export const GEOMETRY_CLASS = '__geometry';

/** Maximum number of classes */
export const MAX_CLASSES = 100;

/** Colors of the classes */
export const CLASS_COLORS = [
    '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324',
    '#808000', '#469990', '#000075', '#800000', '#bfef45', '#fabed4', '#dcbeff', '#aaffc3',
];

/**
 * @typedef {object} ImportClass
 * @property {string} value - the field value, or point, line or polygon
 * @property {string} color - the color, like #e6194b
 * @property {boolean} visible - are the features of the class displayed
 */

/**
 * @typedef {object} ImportStyleSpec
 * @property {string} color - the color without classification, like #e6194b
 * @property {number} width - the line width in pixels
 * @property {number} fillOpacity - the polygon fill opacity, 0 to 1
 * @property {number} pointSize - the point radius in pixels
 * @property {string} classifyBy - the field of the classes, GEOMETRY_CLASS, or empty
 * @property {ImportClass[]} classes - the classes
 * @property {LabelSpec} [label] - the labels
 */

/**
 * @typedef {object} LabelSpec
 * @property {string} field - the field displayed, empty for no label
 * @property {number} size - the font size in pixels
 * @property {string} color - the text color, like #000000
 */

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Simplified geometry type of a feature
 * @param {import('ol/Feature.js').default} feature - the feature
 * @returns {string} point, line, polygon or an empty string
 */
export function geometryKind(feature) {
    const type = feature.getGeometry()?.getType() || '';
    if (/Point/.test(type)) {
        return 'point';
    }
    if (/Line/.test(type)) {
        return 'line';
    }
    if (/Polygon/.test(type)) {
        return 'polygon';
    }
    return type ? 'other' : '';
}

/**
 * Class value of a feature
 * @param {import('ol/Feature.js').default} feature - the feature
 * @param {string} classifyBy - the field of the classes, or GEOMETRY_CLASS
 * @returns {string} the class value
 */
export function classValue(feature, classifyBy) {
    if (classifyBy === GEOMETRY_CLASS) {
        return geometryKind(feature);
    }
    const value = feature.get(classifyBy);
    return value === undefined || value === null ? '' : String(value);
}

/**
 * Fields that can classify the features: those with 2 to MAX_CLASSES values
 * @param {import('ol/Feature.js').default[]} features - the features
 * @returns {string[]} the field names, GEOMETRY_CLASS first when the geometry types are mixed
 */
export function classifiableFields(features) {
    const sample = features.slice(0, 2000);
    const values = new Map();
    const kinds = new Set();
    for (const feature of sample) {
        kinds.add(geometryKind(feature));
        for (const [key, value] of Object.entries(feature.getProperties())) {
            if (key === feature.getGeometryName() || (value !== null && typeof value === 'object')) {
                continue;
            }
            if (!values.has(key)) {
                values.set(key, new Set());
            }
            const set = values.get(key);
            if (set.size <= MAX_CLASSES) {
                set.add(value === undefined || value === null ? '' : String(value));
            }
        }
    }
    const fields = [...values].filter(([, set]) => set.size > 1 && set.size <= MAX_CLASSES).map(([key]) => key);
    return kinds.size > 1 ? [GEOMETRY_CLASS, ...fields] : fields;
}

/**
 * Fields of the features, to label them
 * @param {import('ol/Feature.js').default[]} features - the features
 * @returns {string[]} the field names
 */
export function featureFields(features) {
    const fields = new Set();
    for (const feature of features.slice(0, 200)) {
        for (const [key, value] of Object.entries(feature.getProperties())) {
            if (key !== feature.getGeometryName() && (value === null || typeof value !== 'object')) {
                fields.add(key);
            }
        }
    }
    return [...fields];
}

/**
 * Classes of the features, keeping the colors and visibility of the current ones
 * @param {import('ol/Feature.js').default[]} features - the features
 * @param {string} classifyBy - the field of the classes, GEOMETRY_CLASS, or empty
 * @param {ImportClass[]} [current] - the current classes
 * @returns {ImportClass[]} the classes, sorted by value
 */
export function buildClasses(features, classifyBy, current = []) {
    if (!classifyBy) {
        return [];
    }
    const values = new Set();
    for (const feature of features) {
        values.add(classValue(feature, classifyBy));
        if (values.size > MAX_CLASSES) {
            break;
        }
    }
    const known = new Map(current.map(item => [item.value, item]));
    return [...values].slice(0, MAX_CLASSES)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((value, index) => known.get(value) || {
            value,
            color: CLASS_COLORS[index % CLASS_COLORS.length],
            visible: true,
        });
}

/**
 * Default style of an imported layer: classified by the AutoCAD layer when
 * the features have several, else by geometry type when they are mixed
 * @param {import('ol/Feature.js').default[]} features - the features
 * @param {string} color - the layer color
 * @returns {ImportStyleSpec} the style
 */
export function defaultImportStyle(features, color) {
    const fields = classifiableFields(features);
    let classifyBy = '';
    if (fields.includes('Layer')) {
        classifyBy = 'Layer';
    } else if (fields.includes(GEOMETRY_CLASS)) {
        classifyBy = GEOMETRY_CLASS;
    }
    return {
        color,
        width: 2,
        fillOpacity: 0.25,
        pointSize: 5,
        classifyBy,
        classes: buildClasses(features, classifyBy),
        label: sanitizeLabel(null),
    };
}

/**
 * Check a style read from the browser storage or the user profile
 * @param {object} value - the style
 * @param {string} fallbackColor - the color if the style has none
 * @returns {ImportStyleSpec|null} the style, or null if it is not valid
 */
export function sanitizeImportStyle(value, fallbackColor) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const number = (v, min, max, def) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };
    return {
        color: HEX.test(value.color) ? value.color : fallbackColor,
        width: number(value.width, 0.5, 20, 2),
        fillOpacity: number(value.fillOpacity, 0, 1, 0.25),
        pointSize: number(value.pointSize, 1, 30, 5),
        classifyBy: typeof value.classifyBy === 'string' ? value.classifyBy.substring(0, 100) : '',
        classes: (Array.isArray(value.classes) ? value.classes : []).slice(0, MAX_CLASSES)
            .filter(item => item && typeof item === 'object' && HEX.test(item.color))
            .map(item => ({ value: String(item.value ?? '').substring(0, 200), color: item.color, visible: item.visible !== false })),
        label: sanitizeLabel(value.label),
    };
}

/**
 * Check the label settings
 * @param {object} value - the label settings
 * @returns {LabelSpec} the label settings, without field if not valid
 */
export function sanitizeLabel(value) {
    const label = value && typeof value === 'object' ? value : {};
    const size = Number(label.size);
    return {
        field: typeof label.field === 'string' ? label.field.substring(0, 100) : '',
        size: Number.isFinite(size) ? Math.min(40, Math.max(6, size)) : 12,
        color: HEX.test(label.color) ? label.color : '#000000',
    };
}

/**
 * Label style of a feature
 * @param {import('ol/Feature.js').default} feature - the feature
 * @param {LabelSpec} label - the label settings
 * @returns {Style|null} the style, null without text
 */
export function labelStyle(feature, label) {
    const value = feature.get(label.field);
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const kind = geometryKind(feature);
    return new Style({
        text: new Text({
            text: String(value).substring(0, 200),
            font: `${label.size}px sans-serif`,
            fill: new Fill({ color: label.color }),
            stroke: new Stroke({ color: '#ffffff', width: 3 }),
            placement: kind === 'line' ? 'line' : 'point',
            offsetY: kind === 'point' ? -(label.size) : 0,
            overflow: true,
        }),
    });
}

/**
 * Check the original file name and CRS of an imported layer
 * @param {object} value - the source read from the browser storage or the user profile
 * @returns {{fileName: string, crs: string|null}|null} the source
 */
export function sanitizeImportSource(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const fileName = typeof value.fileName === 'string' ? value.fileName.substring(0, 255) : '';
    const crs = typeof value.crs === 'string' && /^EPSG:\d{4,6}$/.test(value.crs) ? value.crs : null;
    return fileName || crs ? { fileName, crs } : null;
}

/**
 * Color with an opacity
 * @param {string} hex - the color, like #e6194b
 * @param {number} opacity - 0 to 1
 * @returns {string} the rgba color
 */
function rgba(hex, opacity) {
    const n = parseInt(hex.substring(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

/**
 * OpenLayers style function of an imported layer
 * @param {ImportStyleSpec} spec - the style
 * @returns {function(import('ol/Feature.js').default): (Style|Style[]|undefined)} the style function
 */
export function importStyleFunction(spec) {
    const cache = new Map();
    const styleOf = color => {
        if (!cache.has(color)) {
            const stroke = new Stroke({ color, width: spec.width });
            cache.set(color, new Style({
                fill: new Fill({ color: rgba(color, spec.fillOpacity) }),
                stroke,
                image: new Circle({
                    radius: spec.pointSize,
                    fill: new Fill({ color }),
                    stroke: new Stroke({ color: '#ffffff', width: 1 }),
                }),
            }));
        }
        return cache.get(color);
    };
    const label = spec.label?.field ? spec.label : null;
    const withLabel = (feature, style) => {
        const text = label ? labelStyle(feature, label) : null;
        return text ? [style, text] : style;
    };
    if (!spec.classifyBy || !spec.classes.length) {
        return feature => withLabel(feature, styleOf(spec.color));
    }
    const classes = new Map(spec.classes.map(item => [item.value, item]));
    return feature => {
        const item = classes.get(classValue(feature, spec.classifyBy));
        if (!item) {
            return withLabel(feature, styleOf(spec.color));
        }
        return item.visible ? withLabel(feature, styleOf(item.color)) : undefined;
    };
}

/**
 * Legend icon of a color, as a data URL
 * @param {string} color - the color, like #e6194b
 * @param {string} [kind] - point, line or polygon
 * @param {number} [fillOpacity] - the polygon fill opacity
 * @returns {string} the SVG data URL
 */
export function legendIcon(color, kind = 'polygon', fillOpacity = 0.25) {
    let shape;
    if (kind === 'point') {
        shape = `<circle cx="8" cy="8" r="5" fill="${color}" stroke="#fff"/>`;
    } else if (kind === 'line') {
        shape = `<path d="M1 13 L6 5 L10 10 L15 3" fill="none" stroke="${color}" stroke-width="2"/>`;
    } else {
        shape = `<rect x="2" y="2" width="12" height="12" fill="${rgba(color, fillOpacity)}" stroke="${color}" stroke-width="2"/>`;
    }
    return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">${shape}</svg>`);
}
