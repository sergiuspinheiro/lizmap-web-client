import 'ol/ol.css';

// OLMap and not Map to avoid collision with global object Map
import OLMap from 'ol/Map.js';
import View from 'ol/View.js';
import {defaults as defaultControls} from 'ol/control.js';
import LayerGroup from 'ol/layer/Group.js';
import TileLayer from 'ol/layer/Tile.js';
import OSM from 'ol/source/OSM.js';
import Stamen from 'ol/source/Stamen.js';

import {DragZoom} from 'ol/interaction.js';
import {always as alwaysCondition, shiftKeyOnly as shiftKeyOnlyCondition} from 'ol/events/condition.js';

import {LizmapMapManager, MainEventDispatcher} from '../modules/LizmapGlobals.js';

export default class LizmapOlMapElement extends HTMLElement {
    constructor() {
        super();

        this._OLMap = null;
        this._OLlayerGroup = null;
        this._mapId = '';
    }

    get mapId() {
        return this._mapId;
    }

    connectedCallback() {
        this._mapId = this.getAttribute('map-id');

        MainEventDispatcher.addListener(this.onLoadedMapConfig.bind(this),
            {type: 'map-config-loaded', mapId: this.mapId});

        MainEventDispatcher.addListener(this.onLoadedBaseLayers.bind(this),
            {type: 'map-base-layers-loaded', mapId: this.mapId});

        MainEventDispatcher.addListener(this.onBaseLayerVisibility.bind(this),
            {type: 'map-base-layers-visibility', mapId: this.mapId});

        MainEventDispatcher.addListener(this.onZoomSet.bind(this),
            {type: 'map-zoom-set', mapId: this.mapId});

        MainEventDispatcher.addListener(this.onCenterSet.bind(this),
            {type: 'map-center-set', mapId: this.mapId});

        MainEventDispatcher.addListener(this.onMinMaxResolutionSet.bind(this),
            {type: 'map-min-max-resolution-set', mapId: this.mapId});

        MainEventDispatcher.addListener(this.onZoomByRectangleSet.bind(this),
            {type: 'ui-zoom-by-rectangle-set', mapId: this.mapId});
    }

    disconnectedCallback() {
        MainEventDispatcher.removeListener(this.onLoadedMapConfig.bind(this),
            {type: 'map-config-loaded', mapId: this.mapId});

        MainEventDispatcher.removeListener(this.onLoadedBaseLayers.bind(this),
            {type: 'map-base-layers-loaded', mapId: this.mapId});

        MainEventDispatcher.removeListener(this.onBaseLayerVisibility.bind(this),
            {type: 'map-base-layers-visibility', mapId: this.mapId});

        MainEventDispatcher.removeListener(this.onZoomSet.bind(this),
            {type: 'map-zoom-set', mapId: this.mapId});

        MainEventDispatcher.removeListener(this.onCenterSet.bind(this),
            {type: 'map-center-set', mapId: this.mapId});

        MainEventDispatcher.removeListener(this.onMinMaxResolutionSet.bind(this),
            {type: 'map-min-max-resolution-set', mapId: this.mapId});

        MainEventDispatcher.removeListener(this.onZoomByRectangleSet.bind(this),
            {type: 'ui-zoom-by-rectangle-set', mapId: this.mapId});
    }

    onLoadedMapConfig(event) {
        this._mapId = event.mapId;

        this._OLMap = new OLMap({
            controls: defaultControls({zoom: false}),
            target: this,
            view: new View()
        });

        this._OLMap.getView().fit(event.config.options.initialExtent);

        // Cache initial center and zoom
        LizmapMapManager.getMap(this.mapId).initialCenter = this._OLMap.getView().getCenter();
        LizmapMapManager.getMap(this.mapId).initialZoom = this._OLMap.getView().getZoom();

        // Set zoom
        LizmapMapManager.getMap(this.mapId).zoom = this._OLMap.getView().getZoom();

        // Detect zoom changes
        this._OLMap.on('moveend', () => {
            LizmapMapManager.getMap(this.mapId).zoom = this._OLMap.getView().getZoom();
            LizmapMapManager.getMap(this.mapId).center = this._OLMap.getView().getCenter();
            LizmapMapManager.getMap(this.mapId).zoomByRectangleToggle(false);
        }
        );
    }

    onLoadedBaseLayers(event) {
        const OLLayers = event.baseLayerGroup.layers.map((layer) => {
            let olLayer;
            if (layer.layerId === 'osmMapnik') {
                olLayer = new TileLayer({
                    layerId: layer.layerId,
                    visible: layer.visible,
                    source: new OSM()
                });
            } else if (layer.layerId === 'osmStamenToner') {
                olLayer = new TileLayer({
                    layerId: layer.layerId,
                    visible: layer.visible,
                    source: new Stamen({
                        layer: 'toner'
                    })
                });
            }
            return olLayer;
        });

        this._OLlayerGroup = new LayerGroup({
            layers: OLLayers
        });

        this._OLMap.addLayer(this._OLlayerGroup);
    }

    onBaseLayerVisibility(event) {
        const olLayers = this._OLlayerGroup.getLayers();
        event.layers.forEach((lzmLayer, idx) => {
            olLayers.item(idx).setVisible(lzmLayer.visible);
        });
    }

    onZoomSet(event) {
        this._OLMap.getView().setZoom(event.zoom);
    }

    onCenterSet(event) {
        this._OLMap.getView().setCenter(event.center);
    }

    onMinMaxResolutionSet(event) {
        const maxZoom = Math.round(this._OLMap.getView().getZoomForResolution(event.minResolution));
        const minZoom = Math.round(this._OLMap.getView().getZoomForResolution(event.maxResolution));

        this._OLMap.getView().setMinZoom(minZoom);
        this._OLMap.getView().setMaxZoom(maxZoom);

        LizmapMapManager.getMap(this.mapId).setMinMaxZoom(minZoom, maxZoom);
    }

    onZoomByRectangleSet(event) {
        if (event.zoomByRectangleActive) {
            this._OLMap.getInteractions().forEach(function(interaction) {
                if (interaction instanceof DragZoom) {
                    interaction.condition_ = alwaysCondition;
                }
            });
        } else {
            this._OLMap.getInteractions().forEach(function(interaction) {
                if (interaction instanceof DragZoom) {
                    interaction.condition_ = shiftKeyOnlyCondition;
                }
            });
        }

    }
}
