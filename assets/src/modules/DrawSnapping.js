/**
 * @module modules/DrawSnapping.js
 * @name DrawSnapping
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainEventDispatcher } from './Globals.js';
import {
    SnapModes, snapCandidateLayers, fetchSnapFeatures, computeSnapPoints,
    readSnapSettings, saveSnapSettings, tracePath,
    EXTERNAL_PREFIX, externalSnapLayers, externalSnapFeatures,
} from './SnapTargets.js';
import MultiSnap from './interaction/MultiSnap.js';

import GeoJSON from 'ol/format/GeoJSON.js';
import { Vector as VectorSource } from 'ol/source.js';
import { Vector as VectorLayer } from 'ol/layer.js';
import { Feature } from 'ol';
import { LineString, Point } from 'ol/geom.js';
import { snapMarkerStyle, snapIndicatorStyle, snapSegmentStyle, snapTraceStyle } from './SnapStyles.js';

/**
 * Id of the drawings in the layer list
 * @type {string}
 */
export const DRAWINGS_ID = '__drawings__';

/**
 * Snapping of the draw tools (digitizing): the user chooses the layers to snap to
 * (layers published in WFS and the drawings) and the modes: vertices, segments,
 * segment midpoints and intersections.
 * @class
 * @name DrawSnapping
 */
export default class DrawSnapping {

    /**
     * @param {object}   map          - the OpenLayers map (mainLizmap.map)
     * @param {object}   digitizing   - the digitizing module
     * @param {object}   rootMapGroup - root map group
     * @param {object}   layerTree    - root tree layer group
     * @param {object}   lizmap3      - the old lizmap object
     * @param {object[]} featureTypes - WFS feature types
     */
    constructor(map, digitizing, rootMapGroup, layerTree, lizmap3, featureTypes = []) {
        this._map = map;
        this._digitizing = digitizing;
        this._rootMapGroup = rootMapGroup;
        this._layerTree = layerTree;
        this._lizmap3 = lizmap3;

        this._active = false;
        this._refreshable = false;
        this._maxFeatures = 1000;
        this._requestId = 0;
        this._wfsErrorNotified = false;
        this._rebuildTimeout = null;

        // Layers
        this._candidates = snapCandidateLayers(lizmap3, featureTypes);
        this._titles = {[DRAWINGS_ID]: lizDict['snapping.list.drawings'] || 'Drawings'};
        for (const layer of this._candidates) {
            this._titles[layer.id] = layer.title;
        }
        this._traceFeatures = [];

        // Settings
        const saved = readSnapSettings('draw');
        this._checked = new Set(saved && Array.isArray(saved.layers) ? saved.layers : [DRAWINGS_ID]);
        this._modes = {vertices: true, segments: true, midpoints: false, intersections: false};
        if (saved && saved.modes) {
            for (const mode of SnapModes) {
                this._modes[mode] = !!saved.modes[mode];
            }
        }
        this._tolerance = Math.max(1, parseInt(saved?.tolerance) || 10);

        // Data
        this._wfsFeatures = {}; // layerId => GeoJSON features
        this._format = new GeoJSON();
        this._edgesSource = new VectorSource({ wrapX: false });
        this._pointsSource = new VectorSource({ wrapX: false });

        // Show the snap points with symbols like QGIS: vertices, midpoints and intersections
        this._pointsLayer = new VectorLayer({
            source: this._pointsSource,
            style: (feature) => snapMarkerStyle(feature.get('kind')),
            visible: false,
        });
        this._pointsLayer.setProperties({ name: 'LizmapDrawSnappingPointsLayer' });
        this._map.addToolLayer(this._pointsLayer);

        // Indicator following the cursor when it snaps
        this._indicatorPoint = new Feature(new Point([0, 0]));
        this._indicatorSegment = new Feature(new LineString([[0, 0], [0, 0]]));
        this._indicatorSegment.setStyle(snapSegmentStyle);
        this._indicatorTrace = new Feature(new LineString([[0, 0], [0, 0]]));
        this._indicatorTrace.setStyle(snapTraceStyle);
        this._indicatorSource = new VectorSource({ wrapX: false });
        this._indicatorLayer = new VectorLayer({
            source: this._indicatorSource,
            visible: false,
            zIndex: 1000,
        });
        this._indicatorLayer.setProperties({ name: 'LizmapDrawSnappingIndicatorLayer' });
        this._map.addToolLayer(this._indicatorLayer);
        this._map.getViewport().addEventListener('pointerleave', () => this._showIndicator(null));

        this._interaction = new MultiSnap({
            pointsSource: this._pointsSource,
            edgesSource: this._edgesSource,
            pixelTolerance: this._tolerance,
            edges: this._modes.segments,
            onSnap: (result) => this._showIndicator(result),
        });

        // Tracing in the draw tools: when a vertex is added on a feature, the vertices
        // of the feature between the previous vertex and it are added
        this._digitizing.traceVertices = (start, end) => {
            if (!this._active || !this._modes.tracing) {
                return [];
            }
            const tolerance = this._map.getView().getResolution() || 0;
            return tracePath(this._traceFeatures, start, end, tolerance);
        };

        // Keep the snap interaction the last one, so it is applied before the draw ones
        this._onInteractionAdded = (event) => {
            if (!this._active || event.element === this._interaction) {
                return;
            }
            const interactions = this._map.getInteractions();
            interactions.remove(this._interaction);
            interactions.push(this._interaction);
        };
        this._map.getInteractions().on('add', this._onInteractionAdded);

        // Map moved: the features can be reloaded
        this._map.on('moveend', () => {
            if (this._active) {
                this.refreshable = true;
            }
        });

        // Layer visibility changed
        this._rootMapGroup.addListener(() => {
            if (this._active) {
                this.refreshable = true;
            }
            this._dispatch();
        }, ['layer.visibility.changed', 'group.visibility.changed',
            'ext-group.added', 'ext-group.removed', 'ext-group.visibility.changed',
            'ol-layer.added', 'ol-layer.removed', 'ol-layer.visibility.changed', 'ol-layer.wmsTitle.changed']);

        // Drawings changed
        this._digitizing._drawSource.on('change', () => {
            if (this._active && this._checked.has(DRAWINGS_ID)) {
                this._scheduleRebuild();
            }
        });

        // Stop with the draw tool and with the overlay analysis
        const stop = (e) => {
            if (['draw', 'overlay'].includes(e.id) && this._active) {
                this.active = false;
            }
        };
        this._lizmap3.events.on({
            minidockclosed: stop,
            dockclosed: stop,
            rightdockclosed: stop,
        });
    }

    /**
     * Layer visibility in the layer tree
     * @param {string} layerId - the layer id
     * @returns {boolean} visible or not
     */
    _isVisible(layerId) {
        if (layerId === DRAWINGS_ID) {
            return true;
        }
        if (layerId.startsWith(EXTERNAL_PREFIX)) {
            const external = this._externalLayers().find(l => l.id === layerId);
            return !!external && !!external.state.visibility;
        }
        const layerConfig = this._lizmap3.getLayerConfigById(layerId);
        if (!layerConfig || !layerConfig[0]) {
            return false;
        }
        try {
            return this._layerTree.getTreeLayerByName(layerConfig[0]).visibility;
        } catch {
            return false;
        }
    }

    /**
     * Show where the cursor snaps
     * @param {object|null} result - the snap result
     */
    _showIndicator(result) {
        if (!result || !this._active) {
            this._indicatorSource.clear(true);
            this._indicatorLayer.changed();
            return;
        }
        this._indicatorPoint.getGeometry().setCoordinates(result.coordinate);
        this._indicatorPoint.setStyle(snapIndicatorStyle(result.kind));
        const features = [this._indicatorPoint];
        if (result.kind === 'segment' && result.segment) {
            this._indicatorSegment.getGeometry().setCoordinates(result.segment);
            features.unshift(this._indicatorSegment);
        }
        // Tracing: preview of the way along the feature from the last vertex to the cursor
        const trace = this._tracePreview(result.coordinate);
        if (trace) {
            this._indicatorTrace.getGeometry().setCoordinates(trace);
            features.unshift(this._indicatorTrace);
        }
        this._indicatorSource.clear(true);
        this._indicatorSource.addFeatures(features);
    }

    /**
     * The way followed by the tracing from the last vertex of the drawing to a point
     * @param {number[]} coordinate - the snapped cursor coordinate
     * @returns {number[][]|null} the line, or null when there is nothing to trace
     */
    _tracePreview(coordinate) {
        if (!this._modes.tracing || typeof this._digitizing._sketchCoordinates !== 'function') {
            return null;
        }
        const coords = this._digitizing._sketchCoordinates();
        if (!coords || coords.length < 2) {
            return null;
        }
        const last = coords[coords.length - 2].slice(0, 2);
        const tolerance = this._map.getView().getResolution() || 0;
        const path = tracePath(this._traceFeatures, last, coordinate, tolerance);
        if (path.length === 0) {
            return null;
        }
        return [last, ...path, coordinate.slice(0, 2)];
    }

    /**
     * The external vector layers (loaded files, external services)
     * @returns {Array<{id: string, title: string, state: object}>} the layers
     */
    _externalLayers() {
        try {
            return externalSnapLayers(this._rootMapGroup);
        } catch {
            return [];
        }
    }

    /**
     * Ids of all the layers: drawings, project layers, external layers
     * @type {string[]}
     */
    get _layerIds() {
        const externals = this._externalLayers();
        for (const external of externals) {
            this._titles[external.id] = external.title;
        }
        return [DRAWINGS_ID, ...this._candidates.map(l => l.id), ...externals.map(l => l.id)];
    }

    /**
     * Remove the last vertex of the drawing being drawn
     */
    undoVertex() {
        this._digitizing.undoLastVertex?.();
    }

    _dispatch() {
        mainEventDispatcher.dispatch('drawsnapping.changed');
    }

    _save() {
        saveSnapSettings('draw', {
            layers: [...this._checked],
            modes: this._modes,
            tolerance: this._tolerance,
        });
    }

    _notifyWfsError(layerId, detail) {
        console.warn('Snapping: WFS request failed for layer', layerId, detail);
        if (this._wfsErrorNotified) return;
        this._wfsErrorNotified = true;
        this._lizmap3.addMessage(lizDict['snapping.message.wfs_error']
            || 'Snapping: failed to load data for some layers — snap may be incomplete.', 'error', true, 7000);
    }

    /**
     * Rebuild the snap targets after the drawings changed, not while a vertex is moved
     */
    _scheduleRebuild() {
        clearTimeout(this._rebuildTimeout);
        this._rebuildTimeout = setTimeout(() => {
            if (this._interaction.pointerDown) {
                this._scheduleRebuild();
            } else {
                this._rebuild();
            }
        }, 250);
    }

    /**
     * Build the snap targets from the loaded features and the drawings
     */
    _rebuild() {
        this._edgesSource.clear(true);
        this._pointsSource.clear(true);
        this._traceFeatures = [];
        if (!this._active) {
            return;
        }

        let geojsonFeatures = [];
        for (const layerId of this._layerIds) {
            if (layerId !== DRAWINGS_ID && this._checked.has(layerId) && this._isVisible(layerId)) {
                geojsonFeatures = geojsonFeatures.concat(this._wfsFeatures[layerId] || []);
            }
        }
        const olFeatures = geojsonFeatures.length
            ? this._format.readFeatures({type: 'FeatureCollection', features: geojsonFeatures})
            : [];

        if (this._checked.has(DRAWINGS_ID)) {
            for (const drawn of this._digitizing._drawSource.getFeatures()) {
                const geom = drawn.getGeometry();
                // circles have no vertices
                if (!geom || geom.getType() === 'Circle') {
                    continue;
                }
                olFeatures.push(new Feature(geom.clone()));
                geojsonFeatures.push(this._format.writeFeatureObject(new Feature(geom)));
            }
        }

        if (this._modes.segments) {
            this._edgesSource.addFeatures(olFeatures);
        }
        // Tracing follows these features
        this._traceFeatures = geojsonFeatures;

        const points = computeSnapPoints(geojsonFeatures, this._modes);
        const pointFeatures = [];
        const seen = new Set();
        for (const [kind, coordinates] of [
            ['vertex', points.vertices],
            ['midpoint', points.midpoints],
            ['intersection', points.intersections],
        ]) {
            for (const coordinate of coordinates) {
                // a vertex keeps its kind when it is also a midpoint or an intersection
                const key = coordinate[0] + ',' + coordinate[1];
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                const feature = new Feature(new Point(coordinate.slice(0, 2)));
                feature.set('kind', kind, true);
                pointFeatures.push(feature);
            }
        }
        this._pointsSource.addFeatures(pointFeatures);
    }

    /**
     * Load the features of the checked visible layers in the map extent
     */
    refresh() {
        const requestId = ++this._requestId;
        this._wfsErrorNotified = false;
        this._wfsFeatures = {};
        this.refreshable = false;

        const view = this._map.getView();
        const options = {
            projection: view.getProjection().getCode(),
            extent: view.calculateExtent(this._map.getSize()),
            maxFeatures: this._maxFeatures,
        };
        const layerIds = this._layerIds.filter(
            id => id !== DRAWINGS_ID && this._checked.has(id) && this._isVisible(id)
        );
        // Loaded files and external services: the features are already on the map
        for (const external of this._externalLayers()) {
            if (layerIds.includes(external.id)) {
                this._wfsFeatures[external.id] = externalSnapFeatures(external.state, options.extent);
            }
        }
        const requests = layerIds.filter(id => !id.startsWith(EXTERNAL_PREFIX)).map(layerId =>
            fetchSnapFeatures(this._lizmap3, layerId, options).then(features => {
                if (requestId === this._requestId) {
                    this._wfsFeatures[layerId] = features;
                }
            }).catch(err => this._notifyWfsError(layerId, err))
        );
        this._rebuild();
        Promise.all(requests).then(() => {
            if (requestId === this._requestId) {
                this._rebuild();
            }
        });
    }

    toggle() {
        this.active = !this._active;
    }

    get active() {
        return this._active;
    }

    set active(active) {
        active = !!active;
        if (this._active === active) {
            return;
        }
        this._active = active;
        if (active) {
            this._map.addInteraction(this._interaction);
            this._pointsLayer.setVisible(true);
            this._indicatorLayer.setVisible(true);
            this.refresh();
        } else {
            this._map.removeInteraction(this._interaction);
            this._pointsLayer.setVisible(false);
            this._indicatorLayer.setVisible(false);
            this._showIndicator(null);
            this._requestId++;
            this._edgesSource.clear(true);
            this._pointsSource.clear(true);
            this._traceFeatures = [];
            this._refreshable = false;
        }
        this._dispatch();
    }

    get refreshable() {
        return this._refreshable;
    }

    set refreshable(refreshable) {
        this._refreshable = refreshable;
        this._dispatch();
    }

    /**
     * The layers of the snapping panel, the visible ones first
     * @type {Array<{id: string, title: string, enabled: boolean, checked: boolean}>}
     */
    get layers() {
        const layers = this._layerIds.map(id => ({
            id: id,
            title: this._titles[id] || id,
            enabled: this._isVisible(id),
            checked: this._checked.has(id),
        }));
        const drawings = layers.shift();
        const visible = layers.filter(l => l.enabled);
        const hidden = layers.filter(l => !l.enabled);
        return [drawings, ...visible, ...hidden];
    }

    toggleLayer(layerId) {
        if (this._checked.has(layerId)) {
            this._checked.delete(layerId);
        } else {
            this._checked.add(layerId);
        }
        this._save();
        if (this._active) {
            if (layerId === DRAWINGS_ID || this._wfsFeatures[layerId]) {
                this._rebuild();
            } else {
                this.refresh();
            }
        }
        this._dispatch();
    }

    get modes() {
        return this._modes;
    }

    setMode(mode, enabled) {
        if (!SnapModes.includes(mode)) {
            return;
        }
        this._modes = {...this._modes, [mode]: !!enabled};
        this._interaction.edges = this._modes.segments;
        this._save();
        this._rebuild();
        this._dispatch();
    }

    get tolerance() {
        return this._tolerance;
    }

    set tolerance(tolerance) {
        this._tolerance = Math.max(1, Math.min(100, parseInt(tolerance) || 10));
        this._interaction.pixelTolerance = this._tolerance;
        this._save();
        this._dispatch();
    }
}
