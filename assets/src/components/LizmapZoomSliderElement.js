import {LizmapMapManager, MainEventDispatcher} from '../modules/LizmapGlobals';

export default class LizmapZoomSliderElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        this._mapId = this.getAttribute('map-id');

        this._inputRange = document.createElement('input');
        this._inputRange.type = 'range';

        // Set zoom slider orientation as vertical
        // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/range#Change_the_orientation
        this.style = 'display: inline-block;width: 30px;height: 100px;padding: 0;';
        this._inputRange.style = 'width: 100px;height: 30px;margin: 0;transform-origin: 50px 50px;transform: rotate(-90deg);display: block;';

        // Set zoom value on input change
        this._inputRange.addEventListener('change', () => {
            LizmapMapManager.getMap(this.mapId).zoom = this.rangeValue;
        });

        this.appendChild(this._inputRange);

        MainEventDispatcher.addListener(this.onZoomSet.bind(this),
            {type: 'map-zoom-set', mapId: this.mapId});

        MainEventDispatcher.addListener(this.onMinMaxZoomSet.bind(this),
            {type: 'map-min-max-zoom-set', mapId: this.mapId});
    }

    disconnectedCallback() {
        MainEventDispatcher.removeListener(this.onZoomSet.bind(this),
            {type: 'map-zoom-set', mapId: this.mapId});

        MainEventDispatcher.removeListener(this.onMinMaxZoomSet.bind(this),
            {type: 'map-map-min-max-zoom-set', mapId: this.mapId});
    }

    get mapId() {
        return this._mapId;
    }

    get rangeValue(){
        return parseInt(this._inputRange.value, 10);
    }

    onZoomSet(event) {
        if (this.rangeValue !== event.zoom){
            this._inputRange.value = event.zoom;
        }
    }

    onMinMaxZoomSet(event) {
        this._inputRange.min = event.minZoom;
        this._inputRange.max = event.maxZoom;
    }
}
