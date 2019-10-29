import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/js/dist/button';

import LizmapOlMapElement from './components/LizmapOlMapElement.js';
import LizmapBaseLayersElement from './components/LizmapBaseLayersElement.js';
import LizmapZoomByRectangleElement from './components/LizmapZoomByRectangleElement.js';
import LizmapZoomElement from './components/LizmapZoomElement.js';
import LizmapZoomSliderElement from './components/LizmapZoomSliderElement.js';
import LizmapInitialExtentElement from './components/LizmapInitialExtentElement.js';
import LizmapGeolocationElement from './components/LizmapGeolocationElement.js';
import { LizmapMapManager, MainEventDispatcher } from './modules/LizmapGlobals';

window.customElements.define('lizmap-olmap', LizmapOlMapElement);
window.customElements.define('lizmap-baselayers', LizmapBaseLayersElement);
window.customElements.define('lizmap-zoom-by-rectangle', LizmapZoomByRectangleElement);
window.customElements.define('lizmap-zoom', LizmapZoomElement);
window.customElements.define('lizmap-zoom-slider', LizmapZoomSliderElement);
window.customElements.define('lizmap-initial-extent', LizmapInitialExtentElement);
window.customElements.define('lizmap-geolocation-extent', LizmapGeolocationElement);

window.addEventListener('load', function () {

    LizmapMapManager.createMap('mainmap', lizUrls.config, lizUrls.params.repository, lizUrls.params.project);

}, false);

/**
 * Object that export API for external scripts.
 */
const main = {
    manager: LizmapMapManager,
    dispatcher: MainEventDispatcher
};

export { main as default };
