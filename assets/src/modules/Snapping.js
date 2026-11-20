/**
 * @module modules/Snapping.js
 * @name Snapping
 * @copyright 2023 3Liz
 * @license MPL-2.0
 */

import { mainEventDispatcher } from '../modules/Globals.js';
import Edition from './Edition.js';
import { MapLayerLoadStatus, MapRootState } from './state/MapLayer.js';
import { TreeRootState } from './state/LayerTree.js';
import {
    SnapModes, snapCandidateLayers, fetchSnapFeatures, computeSnapPoints, tracePath,
    EXTERNAL_PREFIX, externalSnapLayers, externalSnapFeatures,
    readSnapSettings, saveSnapSettings,
} from './SnapTargets.js';

/**
 * Events of the layers changing the list of the layers to snap to
 * @type {string[]}
 */
const LAYER_EVENTS = [
    'layer.visibility.changed', 'group.visibility.changed',
    'ext-group.added', 'ext-group.removed', 'ext-group.visibility.changed',
    'ol-layer.added', 'ol-layer.removed', 'ol-layer.visibility.changed',
];

/**
 * Snapping of the edition tool.
 *
 * The layers come from the project configuration (snap_layers of the edition layer, checked
 * at start) and from all the layers with a geometry published in WFS: the user chooses which
 * ones to snap to, and the modes: vertices, segments, segment midpoints and intersections.
 * @class
 * @name Snapping
 */
export default class Snapping {

    /**
     * Create a snapping instance
     * @param {Edition}       edition      - The edition module
     * @param {MapRootState}  rootMapGroup - Root map group
     * @param {TreeRootState} layerTree    - Root tree layer group
     * @param {object}        lizmap3      - The old lizmap object
     * @param {object[]}      featureTypes - WFS feature types
     */
    constructor(edition, rootMapGroup, layerTree, lizmap3, featureTypes = []) {

        this._edition = edition;
        this._rootMapGroup = rootMapGroup;
        this._layerTree = layerTree;
        this._lizmap3 = lizmap3;
        this._featureTypes = featureTypes;

        this._active = false;
        this._snapLayersRefreshable = false;

        this._maxFeatures = 1000;
        this._restrictToMapExtent = true;
        this._config = undefined;
        this._snapEnabled = {};
        this._snapToggled = {};
        this._snapLayers = [];
        this._modes = {vertices: true, segments: true, midpoints: false, intersections: false};
        this._tolerance = 10;
        this._settingsKey = undefined;
        this._snapOnStart = false;
        this._pendingMapReadyListener = null;
        this._wfsErrorNotified = false;
        this._fetchedFeatures = [];
        this._requestId = 0;

        // Layer to store snap features (vertices and segments)
        const snapLayer = new OpenLayers.Layer.Vector('snaplayer', {
            visibility: false,
            styleMap: new OpenLayers.StyleMap({
                pointRadius: 2,
                fill: false,
                stroke: false,
                strokeWidth: 3,
                strokeColor: 'red',
                strokeOpacity: 0.8
            })
        });
        this._lizmap3.map.addLayer(snapLayer);
        this._snapLayer = snapLayer;

        // Symbols like the snapping indicators of QGIS
        const graphicNames = {vertex: 'square', midpoint: 'triangle', intersection: 'x', segment: 'circle'};
        const kindStyle = (sizes) => new OpenLayers.Style({
            graphicName: '${graphic}',
            pointRadius: '${radius}',
            strokeColor: '#ff00ff',
            strokeWidth: '${strokeWidth}',
            strokeDashstyle: '${dash}',
            strokeOpacity: sizes.opacity,
            fillColor: '${fillColor}',
            fillOpacity: '${fillOpacity}',
        }, {
            context: {
                graphic: f => graphicNames[f.attributes.kind] || 'circle',
                radius: f => f.attributes.kind === 'vertex' ? sizes.vertex : sizes.other,
                strokeWidth: f => f.attributes.kind === 'intersection' ? sizes.width / 2 : sizes.width,
                dash: f => f.attributes.kind === 'trace' ? 'dash' : 'solid',
                fillColor: f => f.attributes.kind === 'intersection' ? '#ff00ff' : '#ffffff',
                fillOpacity: f => f.attributes.kind === 'intersection' ? sizes.opacity : 0.35,
            }
        });

        // Layer to store the snap points: vertices, segment midpoints and intersections
        const snapPointsLayer = new OpenLayers.Layer.Vector('snappointslayer', {
            visibility: false,
            styleMap: new OpenLayers.StyleMap(kindStyle({vertex: 3.5, other: 5, width: 1.2, opacity: 0.75}))
        });
        this._lizmap3.map.addLayer(snapPointsLayer);
        this._snapPointsLayer = snapPointsLayer;
        this._pointKinds = new Map();

        // Indicator following the cursor when it snaps
        const indicatorLayer = new OpenLayers.Layer.Vector('snapindicatorlayer', {
            visibility: false,
            styleMap: new OpenLayers.StyleMap(kindStyle({vertex: 9, other: 10, width: 2.5, opacity: 1}))
        });
        this._lizmap3.map.addLayer(indicatorLayer);
        this._indicatorLayer = indicatorLayer;

        const snapControl = new OpenLayers.Control.Snapping({
            layer: this._edition.editLayer,
            targets: [{
                layer: snapLayer
            }, {
                layer: snapPointsLayer,
                node: true,
                vertex: false,
                edge: false,
            }]
        });
        this._lizmap3.map.addControls([snapControl]);
        this._lizmap3.controls['snapControl'] = snapControl;

        snapControl.events.on({
            snap: (evt) => {
                let kind = 'segment';
                if (evt.layer === this._snapPointsLayer) {
                    kind = this._pointKinds.get(evt.point.x + ',' + evt.point.y) || 'vertex';
                } else if (evt.snapType !== 'edge') {
                    kind = 'vertex';
                }
                this._indicatorLayer.destroyFeatures();
                const indicators = [new OpenLayers.Feature.Vector(
                    new OpenLayers.Geometry.Point(evt.point.x, evt.point.y), {kind: kind}
                )];
                // Tracing: preview of the way along the feature from the last vertex to the cursor
                const trace = this._tracePreview([evt.point.x, evt.point.y]);
                if (trace) {
                    indicators.unshift(new OpenLayers.Feature.Vector(
                        new OpenLayers.Geometry.LineString(trace.map(([x, y]) => new OpenLayers.Geometry.Point(x, y))),
                        {kind: 'trace'}
                    ));
                }
                this._indicatorLayer.addFeatures(indicators);
            },
            unsnap: () => this._indicatorLayer.destroyFeatures(),
            deactivate: () => this._indicatorLayer.destroyFeatures(),
        });

        this._setSnapLayersRefreshable = () => {
            if(this._active){
                this.snapLayersRefreshable = true;
            }
        }

        this._setSnapLayersVisibility = () => {
            if (this._config === undefined) {
                return;
            }
            // Files loaded or external services added since the form was displayed
            for (const external of this._externalLayers()) {
                if (!this._snapLayers.includes(external.id)) {
                    this._snapLayers.push(external.id);
                }
            }
            this._snapLayers = this._snapLayers.filter(
                id => !id.startsWith(EXTERNAL_PREFIX) || this._externalLayers().some(l => l.id === id)
            );
            this._snapLayers.forEach((layer)=>{
                this._snapEnabled[layer] = this.getLayerTreeVisibility(layer);
            })

            this._sortSnapLayers();
            this._updateConfig();
            if (this._active) {
                this.snapLayersRefreshable = true;
            }

            // dispatch an event, it might be useful to know when the list of visible layer for snap changed
            mainEventDispatcher.dispatch('snapping.layer.visibility.changed');
        }

        // Ctrl+Z or Backspace: remove the last vertex of the feature being drawn
        document.addEventListener('keydown', (event) => {
            const target = event.target;
            if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
                return;
            }
            const undoKey = ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key?.toLowerCase() === 'z')
                || event.key === 'Backspace';
            if (undoKey && this.undoVertex()) {
                event.preventDefault();
                event.stopPropagation();
            }
        });

        // Tracing: when a vertex is added, follow the snapped feature from the previous vertex
        mainEventDispatcher.addListener(
            () => this._installTracing(),
            'edition.drawFeatureActivated'
        );

        // Activate snap when a layer is edited
        mainEventDispatcher.addListener(
            () => this._onFormDisplayed(),
            'edition.formDisplayed'
        );

        // Clean snap when edition ends
        mainEventDispatcher.addListener(
            () => {
                // Remove pending map-ready listener if still waiting
                if (this._pendingMapReadyListener) {
                    this._rootMapGroup.removeListener(
                        this._pendingMapReadyListener, 'layer.load.status.changed'
                    );
                    this._pendingMapReadyListener = null;
                }
                this.active = false;
                this._snapLayer.destroyFeatures();
                this._snapPointsLayer.destroyFeatures();
                this._fetchedFeatures = [];
                this.config = undefined;

                // Remove listener to moveend event to layers visibility event
                this._lizmap3.map.events.unregister('moveend', this, this._setSnapLayersRefreshable);
                this._rootMapGroup.removeListener(
                    this._setSnapLayersVisibility,
                    LAYER_EVENTS
                )
            },
            'edition.formClosed'
        );
    }

    /**
     * Sort the layers: the visible ones first, then by title
     * @private
     */
    _sortSnapLayers() {
        const byTitle = (a, b) => this.getLayerTitle(a).localeCompare(this.getLayerTitle(b));
        const visible = this._snapLayers.filter(id => this._snapEnabled[id]).sort(byTitle);
        const hidden = this._snapLayers.filter(id => !this._snapEnabled[id]).sort(byTitle);
        this._snapLayers = visible.concat(hidden);
    }

    /**
     * Build the snapping configuration when the edition form is displayed
     * @private
     */
    _onFormDisplayed() {
        let editionLayerConfig = null;
        for (const editionLayer in this._lizmap3.config.editionLayers) {
            if (this._lizmap3.config.editionLayers[editionLayer].layerId === this._edition.layerId) {
                editionLayerConfig = this._lizmap3.config.editionLayers[editionLayer];
            }
        }
        if (!editionLayerConfig) {
            return;
        }

        // No snapping for layers without geometry
        const editedLayerConfig = this._lizmap3.getLayerConfigById(this._edition.layerId);
        const editedGeometryType = editedLayerConfig?.[1]?.geometryType;
        if (['none', 'unknown'].includes(editedGeometryType)) {
            return;
        }

        const configuredLayers = Array.isArray(editionLayerConfig.snap_layers) ? editionLayerConfig.snap_layers : [];
        const hasConfig = configuredLayers.length > 0;

        // All the layers the user can snap to
        const layers = [...configuredLayers];
        for (const layer of snapCandidateLayers(this._lizmap3, this._featureTypes)) {
            if (!layers.includes(layer.id)) {
                layers.push(layer.id);
            }
        }
        // Loaded files and external services with geometries
        for (const layer of this._externalLayers()) {
            layers.push(layer.id);
        }
        if (layers.length === 0) {
            return;
        }
        this._snapLayers = layers;
        this._snapEnabled = {};
        this._snapToggled = {};

        // Settings saved by the user for this edition layer, else project configuration
        this._settingsKey = 'edition_' + this._edition.layerId;
        const saved = readSnapSettings(this._settingsKey);
        const isTrue = (key) => editionLayerConfig[key] === 'True' || editionLayerConfig[key] === true;

        this._snapLayers.forEach((layer) => {
            this._snapEnabled[layer] = this.getLayerTreeVisibility(layer);
            if (saved && Array.isArray(saved.layers)) {
                this._snapToggled[layer] = saved.layers.includes(layer);
            } else {
                // on init enable snap by default on the configured visible layers
                this._snapToggled[layer] = configuredLayers.includes(layer) && this._snapEnabled[layer];
            }
        });

        if (saved && saved.modes) {
            this._modes = {};
            for (const mode of SnapModes) {
                this._modes[mode] = !!saved.modes[mode];
            }
        } else if (hasConfig) {
            // The configuration "vertices" and "intersections" both used the vertices of the features
            this._modes = {
                vertices: isTrue('snap_vertices') || isTrue('snap_intersections'),
                segments: isTrue('snap_segments'),
                midpoints: false,
                intersections: isTrue('snap_intersections'),
            };
        } else {
            this._modes = {vertices: true, segments: true, midpoints: false, intersections: false};
        }

        const tolerance = saved?.tolerance ?? editionLayerConfig.snap_vertices_tolerance ?? 10;
        this._tolerance = Math.max(1, parseInt(tolerance) || 10);

        this._sortSnapLayers();
        this._updateConfig();
        this._applyModes();

        // Set edition layer as main layer
        this._lizmap3.controls.snapControl.setLayer(this._edition.editLayer);

        // Listen to moveend event and to layers visibility changes to able data refreshing
        this._lizmap3.map.events.register('moveend', this, this._setSnapLayersRefreshable);
        this._rootMapGroup.addListener(
            this._setSnapLayersVisibility,
            LAYER_EVENTS
        );

        // Auto-activate snapping if configured (snap_on_start).
        // Legacy configs without the key do not auto-activate.
        this._snapOnStart = isTrue('snap_on_start');
        if (this._snapOnStart) {
            this._activateWhenMapReady();
        }
    }

    /**
     * Update the configuration read by the user interface
     * @private
     */
    _updateConfig() {
        this.config = {
            'snap_layers': [...this._snapLayers],
            'snap_enabled': {...this._snapEnabled},
            'snap_on_layers': {...this._snapToggled},
            'snap_modes': {...this._modes},
            'snap_tolerance': this._tolerance,
        };
    }

    /**
     * Save the user choices for the edited layer
     * @private
     */
    _saveSettings() {
        if (!this._settingsKey) {
            return;
        }
        saveSnapSettings(this._settingsKey, {
            layers: this._snapLayers.filter(id => this._snapToggled[id]),
            modes: this._modes,
            tolerance: this._tolerance,
        });
    }

    /**
     * Apply the modes and the tolerance to the snap control targets
     * @private
     */
    _applyModes() {
        const snapControl = this._lizmap3.controls.snapControl;
        const target = snapControl.targets[0];
        // the vertices are in the points layer, to be shown
        target.node = false;
        target.vertex = false;
        target.edge = this._modes.segments;
        target.nodeTolerance = this._tolerance;
        target.vertexTolerance = this._tolerance;
        target.edgeTolerance = this._tolerance;

        const pointsTarget = snapControl.targets[1];
        pointsTarget.node = this._modes.vertices || this._modes.midpoints || this._modes.intersections;
        pointsTarget.nodeTolerance = this._tolerance;
    }

    /**
     * Compute the vertices, the midpoints and the intersections of the fetched features
     * @private
     */
    _updateSnapPoints() {
        this._snapPointsLayer.destroyFeatures();
        this._pointKinds = new Map();
        if (!this._modes.vertices && !this._modes.midpoints && !this._modes.intersections) {
            return;
        }
        const points = computeSnapPoints(this._fetchedFeatures, this._modes);
        const features = [];
        for (const [kind, coordinates] of [
            ['vertex', points.vertices],
            ['midpoint', points.midpoints],
            ['intersection', points.intersections],
        ]) {
            for (const [x, y] of coordinates) {
                const key = x + ',' + y;
                // a vertex keeps its kind when it is also a midpoint or an intersection
                if (this._pointKinds.has(key)) {
                    continue;
                }
                this._pointKinds.set(key, kind);
                features.push(new OpenLayers.Feature.Vector(new OpenLayers.Geometry.Point(x, y), {kind: kind}));
            }
        }
        if (features.length) {
            this._snapPointsLayer.addFeatures(features);
        }
    }

    /**
     * Add the tracing to the drawing control of the edition: when a vertex is added,
     * the vertices of the feature between it and the previous vertex are inserted
     * @private
     */
    _installTracing() {
        const drawControl = this._edition.drawControl;
        const handler = drawControl?.handler;
        if (!this._edition.drawFeatureActivated || !handler || !handler.callbacks || handler._lizmapTracing) {
            return;
        }
        handler._lizmapTracing = true;
        const originalPoint = handler.callbacks.point;
        handler.callbacks.point = (...args) => {
            try {
                this._traceLastVertex(handler);
            } catch (error) {
                console.warn('Snapping: tracing failed', error);
            }
            if (typeof originalPoint === 'function') {
                return originalPoint.apply(drawControl, args);
            }
        };
    }

    /**
     * Insert the traced vertices between the two last vertices of the drawing
     * @param {object} handler - the OpenLayers 2 path or polygon handler
     * @private
     */
    _traceLastVertex(handler) {
        if (!this._active || !this._modes.tracing || !handler.line || !handler.point) {
            return;
        }
        const components = handler.line.geometry.components;
        // the last point added is the one following the mouse, the clicked vertex is before it
        const index = components.indexOf(handler.point.geometry);
        if (index < 2) {
            return;
        }
        const start = components[index - 2];
        const end = components[index - 1];
        const tolerance = this._lizmap3.map.getResolution();
        const path = tracePath(this._fetchedFeatures, [start.x, start.y], [end.x, end.y], tolerance);
        if (path.length === 0) {
            return;
        }
        path.forEach(([x, y], i) => {
            handler.line.geometry.addComponent(new OpenLayers.Geometry.Point(x, y), index - 1 + i);
        });
        handler.drawFeature();
    }

    /**
     * Activate snapping only after all visible map layers have finished loading.
     * This prevents snap WFS requests from competing with map tile rendering
     * on QGIS Server, which can significantly slow down large projects.
     * @private
     */
    _activateWhenMapReady() {
        const isLoading = l => l.visibility
            && (l.loadStatus === MapLayerLoadStatus.Loading
             || l.loadStatus === MapLayerLoadStatus.Undefined);
        const activate = () => {
            this.active = true;
            let previousMessage = document.getElementById('lizmap-snapping-message');
            if (previousMessage) previousMessage.remove();
            this._lizmap3.addMessage(lizDict['snapping.message.activated'] || 'Snapping has been automatically activated.', 'info', true, 7000).attr('id', 'lizmap-snapping-message');
        };

        if (this._rootMapGroup.findMapLayers().filter(isLoading).length === 0) {
            activate();
        } else {
            const listener = () => {
                if (this._rootMapGroup.findMapLayers().filter(isLoading).length === 0) {
                    this._rootMapGroup.removeListener(listener, 'layer.load.status.changed');
                    this._pendingMapReadyListener = null;
                    activate();
                }
            };
            this._pendingMapReadyListener = listener;
            this._rootMapGroup.addListener(listener, 'layer.load.status.changed');
        }
    }

    /**
     * Log a WFS snap failure and surface a user-visible message, once per refresh batch.
     * @param {string}              layerId - the layer whose WFS request failed
     * @param {Error|object|string}  detail  - the error or payload that triggered the notice
     * @private
     */
    _notifySnapWfsError(layerId, detail) {
        console.warn('Snapping: WFS request failed for layer', layerId, detail);
        if (this._wfsErrorNotified) return;
        this._wfsErrorNotified = true;
        const msg = lizDict['snapping.message.wfs_error']
            || 'Snapping: failed to load data for some layers — snap may be incomplete.';
        this._lizmap3.addMessage(msg, 'error', true, 7000);
    }

    getSnappingData () {
        // Empty snapping layers first
        this._snapLayer.destroyFeatures();
        this._snapPointsLayer.destroyFeatures();
        this._fetchedFeatures = [];

        // Reset the once-per-refresh error notification flag
        this._wfsErrorNotified = false;
        const requestId = ++this._requestId;

        // filter only visible layers and toggled layers on the the snap list
        const currentSnapLayers = this._snapLayers.filter(
            (layerId) => this._snapEnabled[layerId] && this._snapToggled[layerId]
        );

        // Request the map projection so QGIS Server reprojects server-side with full
        // PROJ accuracy (including datum grid shifts).
        const mapProjection = this._lizmap3.map.getProjection();
        const mapExtent = this._restrictToMapExtent ? this._lizmap3.map.getExtent() : null;
        const gFormat = new OpenLayers.Format.GeoJSON({ ignoreExtraDims: true });
        const options = {
            projection: mapProjection,
            extent: mapExtent ? [mapExtent.left, mapExtent.bottom, mapExtent.right, mapExtent.top] : null,
            maxFeatures: this._maxFeatures,
        };

        const requests = currentSnapLayers.map(layerId =>
            (layerId.startsWith(EXTERNAL_PREFIX)
                // the features of the loaded files and external services are already on the map
                ? Promise.resolve(externalSnapFeatures(
                    this._externalLayers().find(l => l.id === layerId)?.state, options.extent
                ))
                : fetchSnapFeatures(this._lizmap3, layerId, options)
            ).then(features => {
                if (requestId !== this._requestId) {
                    return;
                }
                // Features are already in map projection
                const tfeatures = gFormat.read({
                    type: 'FeatureCollection',
                    features: features
                });
                this._snapLayer.addFeatures(tfeatures);
                this._fetchedFeatures.push(...features);
            }).catch(err => {
                this._notifySnapWfsError(layerId, err);
            })
        );
        Promise.all(requests).then(() => {
            if (requestId === this._requestId) {
                // new array: the tracing keeps the lines of an array
                this._fetchedFeatures = [...this._fetchedFeatures];
                this._updateSnapPoints();
            }
        });

        this.snapLayersRefreshable = false;
    }

    toggle(){
        this.active = !this._active;
    }

    /**
     * Getting the layer visibility from the layer tree state
     * @param   {string} layerId - the layer id
     * @returns {boolean} the layer visibility
     */
    getLayerTreeVisibility(layerId){
        if (layerId.startsWith(EXTERNAL_PREFIX)) {
            const external = this._externalLayers().find(l => l.id === layerId);
            return !!external && !!external.state.visibility;
        }
        let visible = false;
        let layerConfig = this._lizmap3.getLayerConfigById(layerId);

        if(layerConfig && layerConfig[0]) {
            try {
                visible = this._layerTree.getTreeLayerByName(layerConfig[0]).visibility
            } catch {
                visible = false
            }
        }
        return visible;
    }

    /**
     * Getting the layer tile or the layer name for snap layers list
     * @param   {string} layerId - the layer id
     * @returns {string} the layer title or layer name
     */
    getLayerTitle(layerId){
        if (layerId.startsWith(EXTERNAL_PREFIX)) {
            return this._externalLayers().find(l => l.id === layerId)?.title || layerId;
        }
        let layerConfig = this._lizmap3.getLayerConfigById(layerId);
        if (layerConfig) {
            return layerConfig[1].title || layerConfig[1].name || '';
        }
        return "";
    }

    /**
     * The external vector layers (loaded files, external services)
     * @returns {Array<{id: string, title: string, state: object}>} the layers
     * @private
     */
    _externalLayers() {
        try {
            return externalSnapLayers(this._rootMapGroup);
        } catch {
            return [];
        }
    }

    /**
     * The way followed by the tracing from the last vertex of the feature being drawn to a point
     * @param {number[]} coordinate - the snapped cursor coordinate
     * @returns {number[][]|null} the line, or null when there is nothing to trace
     * @private
     */
    _tracePreview(coordinate) {
        const handler = this._edition.drawControl?.handler;
        if (!this._modes.tracing || !this._edition.drawFeatureActivated || !handler?.line || !handler.point) {
            return null;
        }
        const components = handler.line.geometry.components;
        const index = components.indexOf(handler.point.geometry);
        if (index < 1) {
            return null;
        }
        const last = [components[index - 1].x, components[index - 1].y];
        const path = tracePath(this._fetchedFeatures, last, coordinate, this._lizmap3.map.getResolution());
        if (path.length === 0) {
            return null;
        }
        return [last, ...path, coordinate];
    }

    /**
     * Remove the last vertex of the feature being drawn
     * @returns {boolean} true if a vertex was removed
     */
    undoVertex() {
        const drawControl = this._edition.drawControl;
        if (!this._edition.drawFeatureActivated || !drawControl?.handler?.line || typeof drawControl.undo !== 'function') {
            return false;
        }
        const handler = drawControl.handler;
        const components = handler.line.geometry?.components || [];
        // the ring of a polygon has a closing point, the last point follows the cursor
        const isPolygon = typeof OpenLayers !== 'undefined' && handler instanceof OpenLayers.Handler.Polygon;
        const vertices = components.length - (isPolygon ? 1 : 0) - 1;
        if (vertices <= 1) {
            // Only the first vertex: cancel the drawing, an undo would leave the handler
            // without vertex but still drawing, and the map would follow the mouse
            if (typeof drawControl.cancel === 'function') {
                drawControl.cancel();
            } else {
                handler.cancel();
            }
            return true;
        }
        return !!drawControl.undo();
    }

    get snapEnabled(){
        return this._snapEnabled;
    }

    set snapToggled(layerId){
        this._snapToggled[layerId] = !this._snapToggled[layerId];
        this._saveSettings();
        this._updateConfig();
        if (this._active) {
            this.getSnappingData();
        }
    }

    // Interface shared with the snapping panel of the draw tools

    /**
     * The layers of the snapping panel
     * @type {Array<{id: string, title: string, enabled: boolean, checked: boolean}>}
     */
    get layers() {
        return this._snapLayers.map(id => ({
            id: id,
            title: this.getLayerTitle(id),
            enabled: !!this._snapEnabled[id],
            checked: !!this._snapToggled[id],
        }));
    }

    /**
     * Toggle the snapping on a layer
     * @param {string} layerId - the layer id
     */
    toggleLayer(layerId) {
        this.snapToggled = layerId;
    }

    /**
     * The snap modes
     * @type {{vertices: boolean, segments: boolean, midpoints: boolean, intersections: boolean}}
     */
    get modes() {
        return this._modes;
    }

    /**
     * Enable or disable a snap mode
     * @param {string}  mode    - one of SnapModes
     * @param {boolean} enabled - enabled or not
     */
    setMode(mode, enabled) {
        if (!SnapModes.includes(mode)) {
            return;
        }
        this._modes = {...this._modes, [mode]: !!enabled};
        this._applyModes();
        this._updateSnapPoints();
        this._saveSettings();
        this._updateConfig();
    }

    /**
     * Snap tolerance in pixels
     * @type {number}
     */
    get tolerance() {
        return this._tolerance;
    }

    set tolerance(tolerance) {
        this._tolerance = Math.max(1, Math.min(100, parseInt(tolerance) || 10));
        this._applyModes();
        this._saveSettings();
        this._updateConfig();
    }

    get refreshable() {
        return this._snapLayersRefreshable;
    }

    refresh() {
        this.getSnappingData();
    }

    get snapLayersRefreshable(){
        return this._snapLayersRefreshable;
    }

    set snapLayersRefreshable(refreshable) {
        this._snapLayersRefreshable = refreshable;
        mainEventDispatcher.dispatch('snapping.refreshable');
    }

    get active() {
        return this._active;
    }

    set active(active) {
        this._active = active;

        // (de)activate snap control
        if (this._active) {
            this.getSnappingData();
            this._lizmap3.controls.snapControl.activate();
        } else {
            // Disable refresh button when snapping is inactive
            this.snapLayersRefreshable = false;
            this._lizmap3.controls.snapControl.deactivate();
        }

        // Set snap layers visibility
        this._snapLayer.setVisibility(this._active);
        this._snapPointsLayer.setVisibility(this._active);
        this._indicatorLayer.setVisibility(this._active);
        if (!this._active) {
            this._indicatorLayer.destroyFeatures();
        }

        mainEventDispatcher.dispatch('snapping.active');
    }

    get config() {
        return this._config;
    }

    set config(config) {
        this._config = config;

        mainEventDispatcher.dispatch('snapping.config');
    }
}
