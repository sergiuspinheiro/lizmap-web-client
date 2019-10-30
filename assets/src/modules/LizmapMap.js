import {INCHTOMM, MainEventDispatcher} from './LizmapGlobals.js';
import LizmapLayerGroup from './LizmapLayerGroup.js';
import LizmapLayer from './LizmapLayer.js';

export default class LizmapMap {

    constructor(mapId, repository, project) {
        this._mapId = mapId;
        this._repositoryName = repository;
        this._projectName = project;

        this._center = [null, null];
        this._zoom = -1;

        this._minResolution = -1;
        this._maxResolution = -1;

        // FIXME : Set with help of LizmapOlMapElement.js.
        // Is it possible to set them directly in this class ?
        this._minZoom = -1;
        this._maxZoom = -1;

        this.initialCenter = [null, null];
        this.initialZoom = -1;

        // UI state
        this._zoomByRectangleActive = false;
    }

    setConfig(config) {
        this._config = config;
        MainEventDispatcher.dispatch({
            type: 'map-config-loaded',
            mapId: this._mapId,
            config: this._config
        });

        const baseLayers = [];
        for (const option in config.options) {
            if (option === 'osmMapnik') {
                baseLayers.push(new LizmapLayer(option, 'OSM', config.options.startupBaselayer === 'osm-mapnik'));
            }
            if (option === 'osmStamenToner') {
                baseLayers.push(new LizmapLayer(option, 'OSM Toner', config.options.startupBaselayer === 'osm-stamen-toner'));
            }
        }

        this._baseLayerGroup = new LizmapLayerGroup(this._mapId, baseLayers, {mutuallyExclusive: true});

        MainEventDispatcher.dispatch({
            type: 'map-base-layers-loaded',
            mapId: this._mapId,
            baseLayerGroup: this._baseLayerGroup
        });

        if (Object.prototype.hasOwnProperty.call(config.options, 'minScale') && Object.prototype.hasOwnProperty.call(config.options, 'maxScale')) {
            this._minResolution = config.options.minScale * INCHTOMM / (1000 * 90 * window.devicePixelRatio);
            this._maxResolution = config.options.maxScale * INCHTOMM / (1000 * 90 * window.devicePixelRatio);

            MainEventDispatcher.dispatch({
                type: 'map-min-max-resolution-set',
                mapId: this._mapId,
                minResolution: this._minResolution,
                maxResolution: this._maxResolution
            });
        }
    }

    get zoom() {
        return this._zoom;
    }

    set zoom(zoom) {
        // Avoid infinite loop
        if (this._zoom !== zoom) {
            this._zoom = zoom;

            MainEventDispatcher.dispatch({
                type: 'map-zoom-set',
                mapId: this._mapId,
                zoom: this.zoom
            });
        }
    }

    get center() {
        return this._center;
    }

    /**
     * @param {Array} center
     */
    set center(center) {
        // Avoid infinite loop
        if (this._center[0] !== center[0] || this._center[1] !== center[1]) {
            this._center = [...center];

            MainEventDispatcher.dispatch({
                type: 'map-center-set',
                mapId: this._mapId,
                center: this.center
            });
        }
    }

    /**
     * @param {number} minZoom
     * @param {number} maxZoom
     */
    setMinMaxZoom(minZoom, maxZoom) {
        this._minZoom = minZoom !== undefined ? minZoom : this._minZoom;
        this._maxZoom = maxZoom !== undefined ? maxZoom : this._maxZoom;

        MainEventDispatcher.dispatch({
            type: 'map-min-max-zoom-set',
            mapId: this._mapId,
            minZoom: this._minZoom,
            maxZoom: this._maxZoom
        });
    }

    get baseLayerGroup() {
        return this._baseLayerGroup;
    }

    zoomIn() {
        if (this.zoom < this._maxZoom) {
            this.zoom = this.zoom + 1;
        }
    }

    zoomOut() {
        if (this.zoom > this._minZoom) {
            this.zoom = this.zoom - 1;
        }
    }

    // UI
    zoomByRectangleToggle(force) {
        if (force !== undefined) {
            this._zoomByRectangleActive = force;
        } else {
            this._zoomByRectangleActive = !this._zoomByRectangleActive;
        }

        MainEventDispatcher.dispatch({
            type: 'ui-zoom-by-rectangle-set',
            mapId: this._mapId,
            zoomByRectangleActive: this._zoomByRectangleActive
        });
    }
}
