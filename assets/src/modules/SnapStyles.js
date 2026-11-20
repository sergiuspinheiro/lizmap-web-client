/**
 * @module modules/SnapStyles.js
 * @name SnapStyles
 * @copyright 2026 3Liz
 * @license MPL-2.0
 * @description Symbols of the snapping, like the snapping indicators of QGIS:
 * vertex = square, segment = the segment and a small square on it,
 * midpoint = triangle, intersection = cross (X).
 */

import { Fill, RegularShape, Stroke, Style, Circle } from 'ol/style.js';

/**
 * Color of the snapping (QGIS default snapping marker color)
 * @type {string}
 */
export const SNAP_COLOR = '#ff00ff';

/**
 * Shape options of a snap kind
 * @param {string} kind   - vertex, segment, midpoint or intersection
 * @param {number} radius - radius of the symbol
 * @param {Stroke} stroke - stroke of the symbol
 * @param {Fill}   [fill] - fill of the symbol
 * @returns {RegularShape|Circle} the image
 */
function snapImage(kind, radius, stroke, fill) {
    switch (kind) {
        case 'vertex':
            return new RegularShape({ points: 4, radius: radius, angle: Math.PI / 4, stroke: stroke, fill: fill });
        case 'midpoint':
            return new RegularShape({ points: 3, radius: radius * 1.15, angle: 0, stroke: stroke, fill: fill });
        case 'intersection':
            return new RegularShape({ points: 4, radius: radius * 1.1, radius2: 0, angle: Math.PI / 4, stroke: stroke });
        default:
            return new Circle({ radius: radius * 0.8, stroke: stroke, fill: fill });
    }
}

const markerStyles = {};
/**
 * Style of the snap points shown on the map
 * @param {string} kind - vertex, midpoint or intersection
 * @returns {Style} the style
 */
export function snapMarkerStyle(kind) {
    if (!markerStyles[kind]) {
        markerStyles[kind] = new Style({
            image: snapImage(
                kind,
                kind === 'vertex' ? 3.5 : 4.5,
                new Stroke({ color: 'rgba(255, 0, 255, 0.75)', width: kind === 'intersection' ? 1.5 : 1.2 }),
                kind === 'intersection' ? undefined : new Fill({ color: 'rgba(255, 255, 255, 0.35)' }),
            ),
        });
    }
    return markerStyles[kind];
}

const indicatorStyles = {};
/**
 * Style of the indicator following the cursor when it snaps
 * @param {string} kind - vertex, segment, midpoint or intersection
 * @returns {Style[]} the styles: the segment (for the segment kind) and the symbol
 */
export function snapIndicatorStyle(kind) {
    if (!indicatorStyles[kind]) {
        const halo = new Style({
            image: snapImage(kind, 9, new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 5 })),
        });
        const symbol = new Style({
            image: snapImage(kind, 9, new Stroke({ color: SNAP_COLOR, width: 2.5 })),
        });
        indicatorStyles[kind] = [halo, symbol];
    }
    return indicatorStyles[kind];
}

/**
 * Style of the segment the cursor snaps to
 * @type {Style}
 */
export const snapSegmentStyle = new Style({
    stroke: new Stroke({ color: SNAP_COLOR, width: 3 }),
});

const SVG_START = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">';

/**
 * Style of the preview of the tracing: the way along the feature to the cursor
 * @type {Style[]}
 */
export const snapTraceStyle = [
    new Style({ stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 6 }) }),
    new Style({ stroke: new Stroke({ color: SNAP_COLOR, width: 3, lineDash: [8, 6] }) }),
];

/**
 * SVG icons of the snap modes, for the snapping panel
 * @type {Object<string, string>}
 */
export const snapModeIcons = {
    vertices: SVG_START + '<path d="M2 14 L8 4 L14 10" fill="none" stroke="#888" stroke-width="1.2"/><rect x="5" y="1" width="6" height="6" fill="none" stroke="#f0f" stroke-width="1.8"/></svg>',
    segments: SVG_START + '<path d="M1 13 L15 3" fill="none" stroke="#f0f" stroke-width="2.5"/><circle cx="8" cy="8" r="2.6" fill="#fff" stroke="#f0f" stroke-width="1.5"/></svg>',
    midpoints: SVG_START + '<path d="M1 13 L15 13" fill="none" stroke="#888" stroke-width="1.2"/><path d="M8 5 L12.5 12 L3.5 12 Z" fill="none" stroke="#f0f" stroke-width="1.8"/></svg>',
    tracing: SVG_START + '<path d="M1 12 L5 5 L10 9 L15 3" fill="none" stroke="#888" stroke-width="1.2"/><path d="M1 12 L5 5 L10 9" fill="none" stroke="#f0f" stroke-width="2.4"/>'
        + '<rect x="0" y="10.5" width="3" height="3" fill="#f0f"/><rect x="8.5" y="7.5" width="3" height="3" fill="#f0f"/></svg>',
    intersections: SVG_START + '<path d="M1 3 L15 13 M1 13 L15 3" fill="none" stroke="#888" stroke-width="1.2"/><path d="M4.5 4.5 L11.5 11.5 M4.5 11.5 L11.5 4.5" fill="none" stroke="#f0f" stroke-width="2.2"/></svg>',
};
