
import {library, findIconDefinition, icon} from '@fortawesome/fontawesome-svg-core';
import {faDotCircle} from '@fortawesome/free-regular-svg-icons';
library.add(faDotCircle);

export default class LizmapGeolocationElement extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        this._mapId = this.getAttribute('map-id');

        // Geolocation element not visible by default
        this.style = 'display: none';

        const geolocationButton = document.createElement('button');
        geolocationButton.classList = 'btn btn-danger btn-sm';

        // Set icon
        const iconDef = findIconDefinition({prefix: 'far', iconName: 'dot-circle'});
        const i = icon(iconDef, {
            transform: {
                size: 25
            }
        });
        geolocationButton.appendChild(i.node[0]);

        this.appendChild(geolocationButton);

        if ('geolocation' in navigator) {
            // Element is visible only if the browser has geolocation capability
            this.style.display = 'block';

            navigator.geolocation.getCurrentPosition(function(position) {
                // console.log(position.coords.latitude);
                // console.log(position.coords.longitude);
            });
        }
    }

    disconnectedCallback() {

    }

    get mapId() {
        return this._mapId;
    }
}
