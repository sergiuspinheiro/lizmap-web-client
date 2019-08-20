import { LizmapMapManager, MainEventDispatcher } from "../modules/LizmapGlobals";

import { library, findIconDefinition, icon } from '@fortawesome/fontawesome-svg-core';
import { faSquare } from '@fortawesome/free-solid-svg-icons';
library.add(faSquare);

export default class LizmapZoomByRectangleElement extends HTMLElement {
    constructor() {
        super();

        const shadowRoot = this.attachShadow({ mode: 'open' });

        shadowRoot.innerHTML = `
            <style>
                :host{
                    top: 10px;
                    right: 20px;
                    position: absolute;
                    z-index: 1;
                }
                button{
                    display:block;
                    width: 30px;
                    height: 30px;
                }
                button.active{
                    background: white;
                }
            </style>`;

        this._zoomByRectangleButton = document.createElement('button');

        // Set icon
        const iconDef = findIconDefinition({ prefix: 'fa', iconName: 'square' });
        const i = icon(iconDef);
        this._zoomByRectangleButton.appendChild(i.node[0]);

        // Listen click event
        this._zoomByRectangleButton.addEventListener('click', () => {
            LizmapMapManager.getMap(this.mapId).zoomByRectangleToggle();
        });

        shadowRoot.appendChild(this._zoomByRectangleButton);
    }

    connectedCallback() {
        this._mapId = this.getAttribute('map-id');

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
