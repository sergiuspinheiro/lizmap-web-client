import { LizmapMapManager } from "../modules/LizmapGlobals";

import { library, findIconDefinition, icon } from '@fortawesome/fontawesome-svg-core';
import { faExpandArrowsAlt } from '@fortawesome/free-solid-svg-icons';
library.add(faExpandArrowsAlt);

export default class LizmapInitialExtentElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        this._mapId = this.getAttribute('map-id');

        // Create button
        const initialExtentButton = document.createElement('button');
        initialExtentButton.type = "button";
        initialExtentButton.classList = "btn btn-danger btn-sm";

        // Set icon
        const iconDef = findIconDefinition({ prefix: 'fas', iconName: 'expand-arrows-alt' });
        const i = icon(iconDef, {
            transform: {
                size: 30
            }
        });
        initialExtentButton.appendChild(i.node[0]);

        // Listen click event
        initialExtentButton.addEventListener('click', () => {
            LizmapMapManager.getMap(this.mapId).center = LizmapMapManager.getMap(this.mapId).initialCenter;
            LizmapMapManager.getMap(this.mapId).zoom = LizmapMapManager.getMap(this.mapId).initialZoom;
        });

        this.appendChild(initialExtentButton);
    }

    disconnectedCallback() {

    }

    get mapId() {
        return this._mapId;
    }
}
