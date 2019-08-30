import { LizmapMapManager } from "../modules/LizmapGlobals";

import { library, findIconDefinition, icon } from '@fortawesome/fontawesome-svg-core';
import { faDotCircle } from '@fortawesome/free-regular-svg-icons';
library.add(faDotCircle);

export default class LizmapGeolocationElement extends HTMLElement {
    constructor() {
        super();

        const shadowRoot = this.attachShadow({ mode: 'open' });

        shadowRoot.innerHTML = `
            <style>
            :host{
                top: 180px;
                right: 20px;
                position: absolute;
                z-index: 1;
                display: none;
            }
            button{
                display:block;
                width: 30px;
                height: 30px;
                padding: 0;
            }
            </style>`;

        const geolocationButton = document.createElement('button');

        // Set icon
        const iconDef = findIconDefinition({ prefix: 'far', iconName: 'dot-circle' });
        const i = icon(iconDef);
        geolocationButton.appendChild(i.node[0]);

        // Listen click event
        // initialExtentButton.addEventListener('click', () => {
        //     LizmapMapManager.getMap(this.mapId).center = LizmapMapManager.getMap(this.mapId).initialCenter;
        //     LizmapMapManager.getMap(this.mapId).zoom = LizmapMapManager.getMap(this.mapId).initialZoom;
        // });

        shadowRoot.appendChild(geolocationButton);
    }

    connectedCallback() {
        this._mapId = this.getAttribute('map-id');

        if ("geolocation" in navigator) {
            // Element is visible only if the browser has geolocation capability
            this.style.display = "block";

            navigator.geolocation.getCurrentPosition(function (position) {
                console.log(position.coords.latitude);
                console.log(position.coords.longitude);
            });
        }
    }

    disconnectedCallback() {

    }

    get mapId() {
        return this._mapId;
    }
}
