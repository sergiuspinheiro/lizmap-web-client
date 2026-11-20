/**
 * @module modules/DrawSnapping.js
 * @name DrawSnapping
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainEventDispatcher } from './Globals.js';
import {
    SnapModes, snapCandidateLayers, fetchSnapFeatures, computeSnapPoints,
    readSnapSettings, saveSnapSettings,
} from './SnapTargets.js';
import MultiSnap from './interaction/MultiSnap.js';

import GeoJSON from 'ol/format/GeoJSON.js';
import { Vector as VectorSource } from 'ol/source.js';
import { Vector as VectorLayer } from 'ol/layer.js';
import { Feature } from 'ol';
import { Point } from 'ol/geom.js';
import { Circle, Fill, Stroke, Style } from 'ol/style.js';

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
        this._layerIds = [DRAWINGS_ID, ...this._candidates.map(l => l.id)];
        this._titles = {[DRAWINGS_ID]: lizDict['snapping.list.drawings'] || 'Drawings'};
        for (const layer of this._candidates) {
            this._titles[layer.id] = layer.title;
        }

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

        const pointStyle = new Style({
            image: new Circle({
                radius: 3,
                fill: new Fill({ color: 'rgba(224, 0, 224, 0.7)' }),
                stroke: new Stroke({ color: '#fff', width: 1 }),
            }),
        });
        // Show the computed points only (midpoints and intersections), the vertices are visible on the layers
        this._pointsLayer = new VectorLayer({
            source: this._pointsSource,
            style: (feature) => feature.get('kind') === 'vertex' ? null : pointStyle,
            visible: false,
        });
        this._pointsLayer.setProperties({ name: 'LizmapDrawSnappingPointsLayer' });
        this._map.addToolLayer(this._pointsLayer);

        this._interaction = new MultiSnap({
            pointsSource: this._pointsSource,
            edgesSource: this._edgesSource,
            pixelTolerance: this._tolerance,
            edges: this._modes.segments,
        });

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
        }, ['layer.visibility.changed', 'group.visibility.changed']);

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

        const points = computeSnapPoints(geojsonFeatures, this._modes);
        const pointFeatures = [];
        for (const [kind, coordinates] of [
            ['vertex', points.vertices],
            ['midpoint', points.midpoints],
            ['intersection', points.intersections],
        ]) {
            for (const coordinate of coordinates) {
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
        const requests = layerIds.map(layerId =>
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
            this.refresh();
        } else {
            this._map.removeInteraction(this._interaction);
            this._pointsLayer.setVisible(false);
            this._requestId++;
            this._edgesSource.clear(true);
            this._pointsSource.clear(true);
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
