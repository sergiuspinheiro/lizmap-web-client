/**
 * @module modules/interaction/MultiSnap.js
 * @name MultiSnap
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import Interaction from 'ol/interaction/Interaction.js';
import { buffer, boundingExtent } from 'ol/extent.js';
import { closestOnSegment, squaredDistance } from 'ol/coordinate.js';

/**
 * Snap interaction with several kinds of targets and a priority:
 * first the points (vertices, segment midpoints, intersections), then the segments.
 *
 * Like ol/interaction/Snap it changes the coordinate and the pixel of the map browser
 * events, so it must be the last interaction added to the map.
 * @class
 * @name MultiSnap
 * @augments Interaction
 */
export default class MultiSnap extends Interaction {

    /**
     * @param {object} options - options
     * @param {import('ol/source/Vector.js').default} options.pointsSource - source of the snap points
     * @param {import('ol/source/Vector.js').default} options.edgesSource  - source of the features for the segments snap
     * @param {Function} options.dynamicPoints - (extent) => coordinates of snap points computed on the fly
     * @param {Function} options.dynamicEdges  - (extent) => array of segments [[x,y],[x,y]] computed on the fly
     * @param {number}   options.pixelTolerance - tolerance in pixels
     * @param {boolean}  options.edges - snap to the segments
     */
    constructor(options) {
        super();
        this._pointsSource = options.pointsSource;
        this._edgesSource = options.edgesSource;
        this._dynamicPoints = options.dynamicPoints || (() => []);
        this._dynamicEdges = options.dynamicEdges || (() => []);
        this.pixelTolerance = options.pixelTolerance || 10;
        this.edges = options.edges !== undefined ? options.edges : true;
        this.pointerDown = false;
    }

    /**
     * Change the event coordinate to the snapped one
     * @param {import('ol/MapBrowserEvent.js').default} evt - Map browser event
     * @returns {boolean} true to let the other interactions handle the event
     */
    handleEvent(evt) {
        if (evt.type === 'pointerdown') {
            this.pointerDown = true;
        } else if (evt.type === 'pointerup') {
            this.pointerDown = false;
        }
        if (!evt.coordinate || !evt.pixel) {
            return true;
        }
        const result = this.snapTo(evt.pixel, evt.coordinate, evt.map);
        if (result) {
            evt.coordinate = result.coordinate.slice(0, 2);
            evt.pixel = result.pixel;
        }
        return true;
    }

    /**
     * Find the snapped coordinate
     * @param {number[]} pixel      - the event pixel
     * @param {number[]} coordinate - the event coordinate
     * @param {import('ol/Map.js').default} map - the map
     * @returns {{coordinate: number[], pixel: number[]}|null} the snapped coordinate or null
     */
    snapTo(pixel, coordinate, map) {
        const resolution = map.getView().getResolution();
        if (resolution === undefined) {
            return null;
        }
        const box = buffer(boundingExtent([coordinate]), resolution * this.pixelTolerance);
        const squaredTolerance = this.pixelTolerance * this.pixelTolerance;

        const toResult = (closest) => {
            if (!closest) {
                return null;
            }
            const closestPixel = map.getPixelFromCoordinate(closest);
            if (!closestPixel || squaredDistance(pixel, closestPixel) > squaredTolerance) {
                return null;
            }
            return {
                coordinate: closest,
                pixel: [Math.round(closestPixel[0]), Math.round(closestPixel[1])],
            };
        };

        // Points first
        let closest = null;
        let minDistance = Infinity;
        const considerPoint = (point) => {
            const d = squaredDistance(coordinate, point);
            if (d < minDistance) {
                minDistance = d;
                closest = point;
            }
        };
        if (this._pointsSource) {
            this._pointsSource.forEachFeatureInExtent(box, (feature) => {
                const geom = feature.getGeometry();
                if (geom) {
                    considerPoint(geom.getCoordinates());
                }
            });
        }
        for (const point of this._dynamicPoints(box)) {
            considerPoint(point);
        }
        const pointResult = toResult(closest);
        if (pointResult) {
            return pointResult;
        }

        if (!this.edges) {
            return null;
        }

        // Then segments
        closest = null;
        minDistance = Infinity;
        const considerSegment = (a, b) => {
            if (Math.max(a[0], b[0]) < box[0] || Math.min(a[0], b[0]) > box[2]
                || Math.max(a[1], b[1]) < box[1] || Math.min(a[1], b[1]) > box[3]) {
                return;
            }
            const point = closestOnSegment(coordinate, [a, b]);
            considerPoint(point);
        };
        if (this._edgesSource) {
            this._edgesSource.forEachFeatureInExtent(box, (feature) => {
                const geom = feature.getGeometry();
                if (!geom) {
                    return;
                }
                forEachSegment(geom, considerSegment);
            });
        }
        for (const [a, b] of this._dynamicEdges(box)) {
            considerSegment(a, b);
        }
        return toResult(closest);
    }
}

/**
 * Call a function for each segment of an OpenLayers geometry
 * @param {import('ol/geom/Geometry.js').default} geom - the geometry
 * @param {Function} callback - (a, b) => void
 */
export function forEachSegment(geom, callback) {
    const lines = [];
    switch (geom.getType()) {
        case 'LineString':
        case 'LinearRing':
            lines.push(geom.getCoordinates());
            break;
        case 'MultiLineString':
        case 'Polygon':
            lines.push(...geom.getCoordinates());
            break;
        case 'MultiPolygon':
            for (const polygon of geom.getCoordinates()) {
                lines.push(...polygon);
            }
            break;
        case 'GeometryCollection':
            for (const g of geom.getGeometries()) {
                forEachSegment(g, callback);
            }
            return;
        default:
            return;
    }
    for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
            callback(line[i - 1], line[i]);
        }
    }
}
