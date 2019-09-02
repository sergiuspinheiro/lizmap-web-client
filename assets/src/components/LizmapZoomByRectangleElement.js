import { LizmapMapManager, MainEventDispatcher } from "../modules/LizmapGlobals";

import { library, findIconDefinition, icon } from '@fortawesome/fontawesome-svg-core';
import { faSquare } from '@fortawesome/free-regular-svg-icons';
library.add(faSquare);

export default class LizmapZoomByRectangleElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        this._mapId = this.getAttribute('map-id');

        this._zoomByRectangleButton = document.createElement('button');
        this._zoomByRectangleButton.classList = "btn btn-danger btn-sm";

        // Set icon
        const iconDef = findIconDefinition({ prefix: 'far', iconName: 'square' });
        const i = icon(iconDef, {
            transform: {
                size: 30
            }
        });
        this._zoomByRectangleButton.appendChild(i.node[0]);

        // Listen click event
        this._zoomByRectangleButton.addEventListener('click', () => {
            LizmapMapManager.getMap(this.mapId).zoomByRectangleToggle();
        });

        this.appendChild(this._zoomByRectangleButton);

        MainEventDispatcher.addListener(this.onZoomByRectangleSet.bind(this),
            { type: 'ui-zoom-by-rectangle-set', mapId: this.mapId });
    }

    disconnectedCallback() {
        MainEventDispatcher.removeListener(this.onZoomByRectangleSet.bind(this),
            { type: 'ui-zoom-by-rectangle-set', mapId: this.mapId });
    }

    get mapId() {
        return this._mapId;
    }

    onZoomByRectangleSet(event){
        this._zoomByRectangleButton.classList.toggle('active', event.zoomByRectangleActive);
    }
}
