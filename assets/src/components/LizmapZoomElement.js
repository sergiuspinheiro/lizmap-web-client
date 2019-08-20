import { LizmapMapManager } from "../modules/LizmapGlobals";

import { library, findIconDefinition, icon } from '@fortawesome/fontawesome-svg-core';
import { faPlus, faMinus } from '@fortawesome/free-solid-svg-icons';
library.add(faPlus, faMinus);

export default class LizmapZoomElement extends HTMLElement {
    constructor() {
        super();

        const shadowRoot = this.attachShadow({ mode: 'open' });

        shadowRoot.innerHTML = `
            <style>
                :host{
                    top: 45px;
                    right: 20px;
                    position: absolute;
                    z-index: 1;
                }
                button{
                    display:block;
                    width: 30px;
                    height: 30px;
                }
            </style>`;

        const zoomin = document.createElement('button');
        const zoomout = document.createElement('button');

        // Set icon
        let iconPlus = icon(findIconDefinition({ prefix: 'fa', iconName: 'plus' }));
        zoomin.appendChild(iconPlus.node[0]);

        let iconMinus = icon(findIconDefinition({ prefix: 'fa', iconName: 'minus' }));
        zoomout.appendChild(iconMinus.node[0]);

        zoomin.addEventListener('click', () => {
            LizmapMapManager.getMap(this.mapId).zoomIn();
        });

        zoomout.addEventListener('click', () => {
            LizmapMapManager.getMap(this.mapId).zoomOut();
        });

        shadowRoot.appendChild(zoomin);
        shadowRoot.appendChild(zoomout);
    }

    connectedCallback() {
        this._mapId = this.getAttribute('map-id');
    }

    get mapId() {
        return this._mapId;
    }
}
