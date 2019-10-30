import {LizmapMapManager} from '../modules/LizmapGlobals.js';

import {library, findIconDefinition, icon} from '@fortawesome/fontawesome-svg-core';
import {faPlus, faMinus} from '@fortawesome/free-solid-svg-icons';
library.add(faPlus, faMinus);

export default class LizmapZoomElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        this._mapId = this.getAttribute('map-id');

        const zoomin = document.createElement('button');
        const zoomout = document.createElement('button');

        zoomin.type = 'button';
        zoomin.classList = 'btn btn-danger btn-sm d-block mb-1';

        zoomout.type = 'button';
        zoomout.classList = 'btn btn-danger btn-sm d-block';

        // Set icon
        const iconPlus = icon(findIconDefinition({prefix: 'fa', iconName: 'plus'}), {
            transform: {
                size: 30
            }
        });
        zoomin.appendChild(iconPlus.node[0]);

        const iconMinus = icon(findIconDefinition({prefix: 'fa', iconName: 'minus'}), {
            transform: {
                size: 30
            }
        });
        zoomout.appendChild(iconMinus.node[0]);

        zoomin.addEventListener('click', () => {
            LizmapMapManager.getMap(this.mapId).zoomIn();
        });

        zoomout.addEventListener('click', () => {
            LizmapMapManager.getMap(this.mapId).zoomOut();
        });

        this.appendChild(zoomin);
        this.appendChild(zoomout);
    }

    get mapId() {
        return this._mapId;
    }
}
