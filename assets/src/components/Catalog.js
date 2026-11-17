/**
 * @module components/Catalog.js
 * @name Catalog
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainLizmap } from '../modules/Globals.js';
import { html, render } from 'lit-html';

import ImageLayer from 'ol/layer/Image.js';
import ImageWMS from 'ol/source/ImageWMS.js';
import { transformExtent } from 'ol/proj.js';
import { openCatalogTable } from './CatalogTable.js';
import { SERVICE_TYPES, readService, createLayer, serviceBaseUrl, withParams } from '../modules/ExternalServices.js';
import { base64png } from '../modules/state/SymbologyIcons.js';
import { getDefaultLayerIcon } from '../modules/state/Symbology.js';

/** Drag and drop data type used to move a catalog layer onto the map */
export const CATALOG_DRAG_TYPE = 'application/x-lizmap-catalog-layer';

/**
 * Geographic data catalog: lists the maps and layers the user can access
 * (repository, project and layer group visibility rights are checked by the
 * server), shows a preview of a layer and adds it to the current map, with a
 * button or by drag and drop onto the map.
 *
 * Added layers are WMS layers requested from the source project, in an
 * external group named after the source project.
 * @class
 * @name Catalog
 * @augments HTMLElement
 */
export default class Catalog extends HTMLElement {
    constructor() {
        super();

        this._repositories = null;
        this._error = false;
        this._filter = '';
        // Project layers already loaded: "repo~project" => {title, wmsUrl, layers} or 'loading'
        this._projects = new Map();
        // Project layers requests: "repo~project" => Promise
        this._pending = new Map();
        // External groups created by the catalog: "repo~project" => ExternalMapGroupState
        this._groups = new Map();
        // Preview: {project, layer}
        this._preview = null;
        // External service form: type, URL and the service read
        this._ext = { type: 'wms', url: '', loading: false, service: null };
        // External services added to the map: "type|url" => {type, url, title, capabilities, group}
        this._services = new Map();
        // AI assistant: status from the server, search and analyses
        this._ai = { enabled: false, analysis: false, question: '', loading: false, answer: null, results: [], error: false };
        // Layer analyses by "repo~project~layer": {loading, question, data, error}
        this._analyses = new Map();
        // Search result previewed: id
        this._aiPreview = null;
    }

    connectedCallback() {
        this._dockHandler = (e) => {
            if (e.id === 'catalog' && this._repositories === null) {
                this.load();
            }
        };
        lizMap.events.on({ dockopened: this._dockHandler });

        // Drop a catalog layer onto the map
        const onMap = (e) => !!mainLizmap.map?.getViewport().contains(e.target);
        this._dragOverHandler = (e) => {
            if (onMap(e) && e.dataTransfer && Array.from(e.dataTransfer.types).includes(CATALOG_DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        };
        this._dropHandler = (e) => {
            const data = onMap(e) ? e.dataTransfer?.getData(CATALOG_DRAG_TYPE) : '';
            if (!data) {
                return;
            }
            e.preventDefault();
            const { key, name } = JSON.parse(data);
            const project = this._projects.get(key);
            const layer = project?.layers?.find(l => l.name === name);
            if (layer) {
                this.addLayer(project, layer);
            }
        };
        document.addEventListener('dragover', this._dragOverHandler);
        document.addEventListener('drop', this._dropHandler);

        this._render();
    }

    disconnectedCallback() {
        lizMap.events.off({ dockopened: this._dockHandler });
        document.removeEventListener('dragover', this._dragOverHandler);
        document.removeEventListener('drop', this._dropHandler);
    }

    /**
     * Load the list of repositories and projects the user can access
     * @returns {Promise<void>}
     */
    async load() {
        this._repositories = 'loading';
        this._error = false;
        this._render();
        try {
            const response = await fetch(this.getAttribute('url'));
            if (!response.ok) {
                throw new Error(response.statusText);
            }
            const data = await response.json();
            this._repositories = data.repositories;
        } catch (error) {
            console.error(error);
            this._repositories = [];
            this._error = true;
        }
        this._render();
        this._loadAssistant();
    }

    /**
     * Read whether the AI assistant is available for the user
     * @returns {Promise<void>}
     */
    async _loadAssistant() {
        const url = this.getAttribute('ai-url');
        if (!url) {
            return;
        }
        try {
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                this._ai.enabled = !!data.enabled;
                this._ai.analysis = !!data.analysis;
                this._render();
            }
        } catch (error) {
            console.error(error);
        }
    }

    /**
     * POST a form to the assistant
     * @param {string} url - the action URL
     * @param {object} params - the form parameters
     * @returns {Promise<object>} the JSON answer
     */
    async _postAssistant(url, params) {
        const response = await fetch(url, {
            method: 'POST',
            body: new URLSearchParams(params),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || response.statusText);
            // A gateway timeout comes from the web server, without JSON
            error.reason = data.reason || ({ 504: 'timeout', 429: 'busy', 401: 'login' })[response.status] || 'error';
            throw error;
        }
        return data;
    }

    /**
     * Search the catalog layers with the question in natural language
     * @returns {Promise<void>}
     */
    async searchWithAssistant() {
        const question = this._ai.question.trim();
        if (!question || this._ai.loading) {
            return;
        }
        Object.assign(this._ai, { loading: true, answer: null, results: [], error: false });
        this._aiPreview = null;
        this._render();
        try {
            const data = await this._postAssistant(this.getAttribute('ai-search-url'), { q: question });
            this._ai.answer = data.answer;
            this._ai.results = data.results || [];
        } catch (error) {
            console.error(error);
            this._ai.error = { reason: error.reason || 'error', message: error.message };
        }
        this._ai.loading = false;
        this._render();
    }

    /**
     * Find the catalog project of a search result, and load its layers
     * @param {{repository: string, project: string, name: string}} result - the search result
     * @returns {Promise<{project: object, layer: object}|null>} the loaded project and layer
     */
    async _resultLayer(result) {
        const repository = this._repositories?.find?.(r => r.id === result.repository);
        const project = repository?.projects.find(p => p.id === result.project);
        if (!project) {
            return null;
        }
        project.key = repository.id + '~' + project.id;
        await this.loadProject(project);
        const loaded = this._projects.get(project.key);
        const layer = loaded?.layers?.find(l => l.name === result.name);
        return layer ? { project: loaded, layer } : null;
    }

    /**
     * Add the layer of a search result to the map
     * @param {object} result - the search result
     * @returns {Promise<void>}
     */
    async addResult(result) {
        const found = await this._resultLayer(result);
        if (found) {
            this.addLayer(found.project, found.layer);
        }
    }

    /**
     * Show or hide the preview of a search result
     * @param {object} result - the search result
     * @returns {Promise<void>}
     */
    async previewResult(result) {
        if (this._aiPreview === result.id) {
            this._aiPreview = null;
            this._render();
            return;
        }
        this._aiPreview = result.id;
        await this._resultLayer(result);
        this._render();
    }

    /**
     * Analyse a layer with the assistant
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @returns {Promise<void>}
     */
    async analyseLayer(project, layer) {
        const id = project.key + '~' + layer.name;
        const analysis = this._analyses.get(id) || { question: '' };
        if (analysis.loading) {
            return;
        }
        Object.assign(analysis, { loading: true, data: null, error: false });
        this._analyses.set(id, analysis);
        this._render();
        try {
            analysis.data = await this._postAssistant(this.getAttribute('ai-analyse-url'), {
                repository: project.repository,
                project: project.project,
                layer: layer.name,
                q: analysis.question || '',
            });
        } catch (error) {
            console.error(error);
            analysis.error = { reason: error.reason || 'error', message: error.message };
        }
        analysis.loading = false;
        this._render();
    }

    /**
     * Load the layers of a project
     * @param {object} project - the project from the catalog list
     * @returns {Promise<void>}
     */
    loadProject(project) {
        if (!this._pending.has(project.key)) {
            this._pending.set(project.key, this._fetchProject(project));
        }
        return this._pending.get(project.key);
    }

    /**
     * Fetch the layers of a project
     * @param {object} project - the project from the catalog list
     * @returns {Promise<void>}
     */
    async _fetchProject(project) {
        const key = project.key;
        this._projects.set(key, 'loading');
        this._render();
        try {
            const response = await fetch(project.layersUrl);
            if (!response.ok) {
                throw new Error(response.statusText);
            }
            const data = await response.json();
            data.key = key;
            this._projects.set(key, data);
        } catch (error) {
            console.error(error);
            this._projects.set(key, { key, title: project.title, layers: [], error: true });
        }
        this._render();
    }

    /**
     * Read the layers of the external service given in the form
     * @returns {Promise<void>}
     */
    async readExternalService() {
        const { type, url } = this._ext;
        if (!url.trim()) {
            return;
        }
        this._ext.loading = true;
        this._ext.service = null;
        this._render();
        try {
            this._ext.service = await readService(type, url);
            if (this._ext.service.layers.length === 0) {
                lizMap.addMessage(lizDict['catalog.external.nolayer'], 'warning', true);
            }
        } catch (error) {
            console.error(error);
            lizMap.addMessage(lizDict['catalog.external.error'] + ' (' + error.message + ')', 'danger', true);
        }
        this._ext.loading = false;
        this._render();
    }

    _serviceKey(type, url) {
        return type + '|' + (['xyz', 'geojson'].includes(type) ? url.trim() : serviceBaseUrl(url));
    }

    /**
     * Is a layer of an external service added to the map
     * @param {string} type - the service type
     * @param {string} url - the service URL
     * @param {string} name - the layer name
     * @returns {boolean} true if added
     */
    isExternalAdded(type, url, name) {
        const service = this._services.get(this._serviceKey(type, url));
        return !!service && service.group.children.some(item => item.name === (name || 'layer'));
    }

    /**
     * Add a layer of an external service to the map
     * @param {string} type - one of SERVICE_TYPES
     * @param {string} url - the service URL
     * @param {string} name - the layer name, empty for XYZ, GeoJSON or a whole ArcGIS map service
     * @param {string} title - the layer title
     * @param {{title: string, capabilities: object|null}} service - the service read by readService
     */
    addExternalLayer(type, url, name, title, service) {
        if (this.isExternalAdded(type, url, name)) {
            lizMap.addMessage(lizDict['catalog.layer.already'], 'info', true);
            return;
        }
        let olLayer;
        try {
            olLayer = createLayer(type, url, name, service.capabilities, mainLizmap.projection);
        } catch (error) {
            console.error(error);
            lizMap.addMessage(lizDict['catalog.external.error'] + ' (' + error.message + ')', 'danger', true);
            return;
        }
        const layerName = name || 'layer';
        olLayer.set('name', layerName);
        const key = this._serviceKey(type, url);
        // Lets the layer tree display the layer settings
        olLayer.set('lizmapCatalog', { key: 'external|' + key, name: layerName });
        let entry = this._services.get(key);
        if (!entry) {
            const group = mainLizmap.state.rootMapGroup.createExternalGroup('external-' + key);
            group.wmsTitle = service.title;
            entry = { type, url, title: service.title, capabilities: service.capabilities, group };
            this._services.set(key, entry);
        }
        const layerState = entry.group.addOlLayer(layerName, olLayer);
        layerState.wmsTitle = title;
        this._render();
    }

    /**
     * Remove a layer of an external service
     * @param {string} type - the service type
     * @param {string} url - the service URL
     * @param {string} name - the layer name
     */
    removeExternalLayer(type, url, name) {
        const key = this._serviceKey(type, url);
        const entry = this._services.get(key);
        if (!entry) {
            return;
        }
        entry.group.removeOlLayer(name || 'layer');
        if (entry.group.childrenCount === 0) {
            mainLizmap.state.rootMapGroup.removeExternalGroup(entry.group.name);
            this._services.delete(key);
        }
        this._render();
    }

    /**
     * Layers of external services added to the map, to save them in a map view
     * @type {Array<{type: string, url: string, layer: string, title: string, opacity: number}>}
     */
    get externalLayers() {
        const list = [];
        for (const entry of this._services.values()) {
            for (const item of [...entry.group.children].reverse()) {
                list.push({
                    type: entry.type,
                    url: entry.url,
                    layer: item.name === 'layer' ? '' : item.name,
                    title: item.wmsTitle,
                    opacity: item.opacity,
                });
            }
        }
        return list;
    }

    /**
     * Replace the layers of external services by the ones of a saved map view
     * @param {Array<{type: string, url: string, layer: string, title: string, opacity: number}>} list - the layers
     * @returns {Promise<void>}
     */
    async restoreExternal(list) {
        for (const entry of this._services.values()) {
            entry.group.clean();
            mainLizmap.state.rootMapGroup.removeExternalGroup(entry.group.name);
        }
        this._services.clear();
        const services = new Map();
        for (const item of (Array.isArray(list) ? list : [])) {
            if (!SERVICE_TYPES.includes(item.type) || typeof item.url !== 'string') {
                continue;
            }
            const key = this._serviceKey(item.type, item.url);
            try {
                if (!services.has(key)) {
                    services.set(key, await readService(item.type, item.url));
                }
                this.addExternalLayer(item.type, item.url, item.layer || '', item.title || item.layer, services.get(key));
                const state = this._services.get(key)?.group.children.find(c => c.name === (item.layer || 'layer'));
                if (state && typeof item.opacity === 'number') {
                    state.opacity = item.opacity;
                }
            } catch (error) {
                console.error(error);
                lizMap.addMessage(lizDict['catalog.external.error'] + ' (' + item.url + ')', 'warning', true);
            }
        }
        this._render();
    }

    _externalTemplate() {
        const ext = this._ext;
        const service = ext.service;
        return html`
        <details class="catalog-external">
            <summary>${lizDict['catalog.external.title']}</summary>
            <div class="catalog-external-form">
                <select class="catalog-external-type form-select form-select-sm"
                    @change=${(e) => { ext.type = e.target.value; ext.service = null; this._render(); }}>
                    ${SERVICE_TYPES.map(type => html`
                        <option value="${type}" ?selected=${ext.type === type}>${lizDict['catalog.external.type.' + type]}</option>`)}
                </select>
                <div class="input-group input-group-sm">
                    <input type="url" class="catalog-external-url form-control form-control-sm"
                        placeholder="${lizDict['catalog.external.url.' + ext.type] || lizDict['catalog.external.url']}"
                        .value=${ext.url}
                        @input=${(e) => { ext.url = e.target.value; }}
                        @keydown=${(e) => { if (e.key === 'Enter') { this.readExternalService(); } }}>
                    <button type="button" class="btn btn-sm catalog-external-load" ?disabled=${ext.loading}
                        @click=${() => this.readExternalService()}>${lizDict['catalog.external.load']}</button>
                </div>
            </div>
            ${ext.loading ? html`<p class="catalog-loading">${lizDict['catalog.loading']}</p>` : ''}
            ${service ? html`
                <ul class="catalog-layers">
                    ${service.layers.filter(l => this._match(l.title, l.name)).map(l => {
                        const added = this.isExternalAdded(ext.type, ext.url, l.name);
                        return html`
                        <li class="catalog-layer catalog-external-layer ${added ? 'added' : ''}">
                            <span class="catalog-layer-title">${l.title}</span>
                            <span class="catalog-layer-actions">
                                ${added
                                    ? html`<button type="button" class="btn btn-sm catalog-remove" title="${lizDict['catalog.layer.remove']}"
                                        @click=${() => this.removeExternalLayer(ext.type, ext.url, l.name)}><i class="icon-remove"></i></button>`
                                    : html`<button type="button" class="btn btn-sm btn-primary catalog-add" title="${lizDict['catalog.layer.add']}"
                                        @click=${() => this.addExternalLayer(ext.type, ext.url, l.name, l.title, service)}><i class="icon-plus icon-white"></i></button>`}
                            </span>
                        </li>`;
                    })}
                </ul>` : ''}
        </details>`;
    }

    /**
     * Layers added from the catalog, to save them in a map view
     * @type {Array<{repository: string, project: string, layer: string, style: string, opacity: number}>}
     */
    get addedLayers() {
        const list = [];
        for (const [key, group] of this._groups) {
            const [repository, project] = key.split('~');
            // Children are listed from the top of the group
            for (const item of [...group.children].reverse()) {
                list.push({
                    repository,
                    project,
                    layer: item.name,
                    style: item.olLayer.getSource().getParams().STYLES || '',
                    opacity: item.opacity,
                });
            }
        }
        return list;
    }

    /**
     * Replace the layers added from the catalog by the layers of a saved
     * map view. Layers the user can no longer access are ignored.
     * @param {Array<{repository: string, project: string, layer: string}>} list - the layers to add
     * @returns {Promise<number>} the number of layers added
     */
    async restore(list) {
        for (const group of this._groups.values()) {
            group.clean();
            mainLizmap.state.rootMapGroup.removeExternalGroup(group.name);
        }
        this._groups.clear();
        if (!Array.isArray(list) || list.length === 0) {
            this._render();
            return 0;
        }
        if (this._repositories === null || this._repositories === 'loading') {
            await this.load();
        }
        let count = 0;
        for (const item of list) {
            const repository = (this._repositories || []).find(r => r.id === item.repository);
            const project = repository?.projects.find(p => p.id === item.project);
            if (!project) {
                continue;
            }
            project.key = repository.id + '~' + project.id;
            await this.loadProject(project);
            const loaded = this._projects.get(project.key);
            const layer = loaded?.layers?.find(l => l.name === item.layer);
            if (layer && !this.isAdded(loaded, layer)) {
                this.addLayer(loaded, layer, { style: item.style, opacity: item.opacity });
                count++;
            }
        }
        this._render();
        return count;
    }

    /**
     * Is the layer already added to the map
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @returns {boolean} true if added
     */
    isAdded(project, layer) {
        const group = this._groups.get(project.key);
        return !!group && group.children.some(item => item.name === layer.name);
    }

    /**
     * Add a catalog layer to the map, in the external group of its project
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @param {{style?: string, opacity?: number}} settings - the layer style and opacity
     */
    addLayer(project, layer, settings = {}) {
        if (this.isAdded(project, layer)) {
            lizMap.addMessage(lizDict['catalog.layer.already'], 'info', true);
            return;
        }
        const olLayer = new ImageLayer({
            source: new ImageWMS({
                url: project.wmsUrl,
                params: {
                    LAYERS: layer.wmsName,
                    STYLES: this._validStyle(layer, settings.style),
                    FORMAT: layer.imageFormat || 'image/png',
                    TRANSPARENT: true,
                },
                ratio: 1,
                projection: mainLizmap.projection,
            }),
        });
        olLayer.set('name', layer.name);
        // Lets the layer tree display the catalog layer settings
        olLayer.set('lizmapCatalog', { key: project.key, name: layer.name });

        let group = this._groups.get(project.key);
        if (!group) {
            // The map wiring listens to the group creation, so the group and
            // its first layer are created in the same tick.
            group = mainLizmap.state.rootMapGroup.createExternalGroup('catalog-' + project.key);
            group.wmsTitle = project.title;
            this._groups.set(project.key, group);
        }
        const layerState = group.addOlLayer(layer.name, olLayer);
        layerState.wmsTitle = layer.title;
        // Icon of the geometry type, as the project layers, until the legend is read
        const defaultIcon = getDefaultLayerIcon({
            type: 'layer',
            layerType: layer.geometryType && layer.geometryType !== 'none' ? 'vector' : 'raster',
            geometryType: layer.geometryType && layer.geometryType !== 'none' ? layer.geometryType : null,
        });
        if (defaultIcon) {
            layerState.icon = defaultIcon;
        }
        if (typeof settings.opacity === 'number' && settings.opacity >= 0 && settings.opacity <= 1) {
            layerState.opacity = settings.opacity;
        }
        this._registerPopup();
        this._render();
        this._loadLegend(project, layer, layerState);
    }

    /**
     * Read the legend of a catalog layer for the layer tree: the layer icon
     * and its symbols, like the layers of the project
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @param {object} layerState - the layer state in the external group
     * @returns {Promise<void>}
     */
    async _loadLegend(project, layer, layerState) {
        const olLayer = layerState.olLayer;
        const style = olLayer.getSource().getParams().STYLES || '';
        try {
            const response = await fetch(this.legendUrl(project, layer, style, 'application/json'));
            if (!response.ok) {
                throw new Error(response.status + ' ' + response.statusText);
            }
            const node = (await response.json())?.nodes?.[0];
            // The style may have changed during the request
            if (!node || (olLayer.getSource().getParams().STYLES || '') !== style) {
                return;
            }
            const symbols = (node.symbols || [])
                .filter(symbol => symbol.icon)
                .map(symbol => ({ title: String(symbol.title ?? ''), icon: base64png + symbol.icon }));
            const icon = node.icon || (symbols.length === 1 ? symbols[0].icon.slice(base64png.length) : '');
            if (icon) {
                layerState.icon = base64png + icon;
            }
            olLayer.set('lizmapCatalogSymbols', symbols.length > 1 ? symbols : []);
            this._render();
        } catch (error) {
            console.warn(error);
        }
    }

    /**
     * A style of the layer, the default one if unknown
     * @param {object} layer - the layer
     * @param {string|undefined} style - the wanted style
     * @returns {string} the style name, empty for the default style
     */
    _validStyle(layer, style) {
        return (layer.styles || []).includes(style) ? style : '';
    }

    /**
     * The map layer state of an added catalog layer
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @returns {object|undefined} the OlMapLayerState
     */
    layerState(project, layer) {
        return this._groups.get(project.key)?.children.find(item => item.name === layer.name);
    }

    /**
     * Change the style of an added layer
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @param {string} style - the style name
     */
    setStyle(project, layer, style) {
        const source = this.layerState(project, layer)?.olLayer.getSource();
        source?.updateParams({ STYLES: this._validStyle(layer, style) });
        this._render();
        const layerState = this.layerState(project, layer);
        if (layerState) {
            this._loadLegend(project, layer, layerState);
        }
    }

    /**
     * Query the visible catalog layers with popups when the user clicks on
     * the map, with the popup configuration of their project.
     */
    _registerPopup() {
        if (this._popupRegistered || !mainLizmap.popup) {
            return;
        }
        this._popupRegistered = true;
        mainLizmap.popup.addFeatureInfoProvider(() => {
            const requests = [];
            for (const [key, group] of this._groups) {
                const project = this._projects.get(key);
                if (!project?.layers || !group.visibility) {
                    continue;
                }
                const layers = [];
                const styles = [];
                for (const item of group.children) {
                    const layer = project.layers.find(l => l.name === item.name);
                    if (layer?.popup && item.visibility) {
                        layers.push(layer.wmsName);
                        styles.push(item.olLayer.getSource().getParams().STYLES || '');
                    }
                }
                if (layers.length) {
                    requests.push({ repository: project.repository, project: project.project, layers, styles });
                }
            }
            return requests;
        });
    }

    /**
     * GetLegendGraphic URL of a layer
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @param {string} style - the style name
     * @param {string} [format] - the legend format
     * @returns {string} the URL
     */
    legendUrl(project, layer, style, format = 'image/png') {
        const params = new URLSearchParams({
            SERVICE: 'WMS',
            VERSION: '1.3.0',
            REQUEST: 'GetLegendGraphic',
            LAYER: layer.wmsName,
            STYLE: style || '',
            FORMAT: format,
            TRANSPARENT: 'true',
        });
        return project.wmsUrl + (project.wmsUrl.includes('?') ? '&' : '?') + params.toString();
    }

    /**
     * Remove a catalog layer from the map
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     */
    removeLayer(project, layer) {
        const group = this._groups.get(project.key);
        if (!group) {
            return;
        }
        group.removeOlLayer(layer.name);
        if (group.childrenCount === 0) {
            mainLizmap.state.rootMapGroup.removeExternalGroup(group.name);
            this._groups.delete(project.key);
        }
        this._render();
    }

    /**
     * Zoom to the layer extent
     * @param {object} layer - the layer
     */
    /**
     * Has the layer a usable extent: not a table without geometry, nor an
     * empty layer (infinite or inverted extent)
     * @param {object} layer - the layer
     * @returns {boolean} true if the layer can be drawn and zoomed to
     */
    hasExtent(layer) {
        if (layer.geometryType === 'none' || !layer.crs || !Array.isArray(layer.extent) || layer.extent.length !== 4) {
            return false;
        }
        const [xmin, ymin, xmax, ymax] = layer.extent.map(Number);
        return [xmin, ymin, xmax, ymax].every(Number.isFinite) && xmin <= xmax && ymin <= ymax;
    }

    zoomToLayer(layer) {
        if (!this.hasExtent(layer)) {
            return;
        }
        try {
            const extent = transformExtent(layer.extent, layer.crs, mainLizmap.projection);
            mainLizmap.map.getView().fit(extent, { maxZoom: 18, padding: [20, 20, 20, 20] });
        } catch (error) {
            console.error(error);
        }
    }

    /**
     * GetMap URL of a small image of the layer on its extent
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @returns {string} the URL, or an empty string if the layer has no extent
     */
    thumbnailUrl(project, layer) {
        if (!this.hasExtent(layer)) {
            return '';
        }
        let [xmin, ymin, xmax, ymax] = layer.extent.map(Number);
        // Single point or flat extent: add a margin
        const margin = Math.max(xmax - xmin, ymax - ymin) * 0.05 || (layer.crs === 'EPSG:4326' ? 0.01 : 500);
        xmin -= margin; ymin -= margin; xmax += margin; ymax += margin;
        const width = 280;
        const height = Math.max(40, Math.min(280, Math.round(width * (ymax - ymin) / (xmax - xmin))));
        // WMS 1.1.1 keeps the x/y axis order for every CRS
        const params = new URLSearchParams({
            SERVICE: 'WMS',
            VERSION: '1.1.1',
            REQUEST: 'GetMap',
            LAYERS: layer.wmsName,
            STYLES: '',
            SRS: layer.crs,
            BBOX: [xmin, ymin, xmax, ymax].join(','),
            WIDTH: width,
            HEIGHT: height,
            FORMAT: 'image/png',
            TRANSPARENT: 'true',
        });
        return project.wmsUrl + (project.wmsUrl.includes('?') ? '&' : '?') + params.toString();
    }

    /**
     * Does the text match the filter
     * @param {...string} texts - texts to look into
     * @returns {boolean} true if matching or no filter
     */
    _match(...texts) {
        if (!this._filter) {
            return true;
        }
        const filter = this._filter.toLowerCase();
        return texts.some(t => (t || '').toString().toLowerCase().includes(filter));
    }

    _layerTemplate(project, layer) {
        const added = this.isAdded(project, layer);
        const previewed = this._preview?.project === project && this._preview?.layer === layer;
        return html`
        <li class="catalog-layer ${added ? 'added' : ''} ${previewed ? 'previewed' : ''}"
            draggable="true"
            title="${lizDict['catalog.layer.drag']}"
            @dragstart=${(e) => {
                e.dataTransfer.setData(CATALOG_DRAG_TYPE, JSON.stringify({ key: project.key, name: layer.name }));
                e.dataTransfer.effectAllowed = 'copy';
            }}>
            <span class="catalog-layer-title">${layer.title}</span>
            <span class="catalog-layer-actions">
                <button type="button" class="btn btn-sm catalog-preview" title="${lizDict['catalog.layer.preview']}"
                    @click=${() => { this._preview = previewed ? null : { project, layer }; this._render(); }}>
                    <i class="icon-info-sign"></i>
                </button>
                ${added
                    ? html`<button type="button" class="btn btn-sm catalog-remove" title="${lizDict['catalog.layer.remove']}"
                        @click=${() => this.removeLayer(project, layer)}><i class="icon-remove"></i></button>`
                    : html`<button type="button" class="btn btn-sm btn-primary catalog-add" title="${lizDict['catalog.layer.add']}"
                        @click=${() => this.addLayer(project, layer)}><i class="icon-plus icon-white"></i></button>`}
            </span>
            ${added ? this._settingsTemplate(project, layer) : ''}
            ${previewed ? this._previewTemplate(project, layer) : ''}
        </li>`;
    }

    /**
     * Settings of an added layer, for the layer tree
     * @param {string} key - the project key, repository~project
     * @param {string} name - the layer name
     * @returns {import('lit-html').TemplateResult|string} the template
     */
    settingsTemplate(key, name) {
        if (key.startsWith('external|')) {
            return this._externalSettingsTemplate(key.substring('external|'.length), name);
        }
        const project = this._projects.get(key);
        const layer = project?.layers?.find(l => l.name === name);
        return layer ? this._settingsTemplate(project, layer) : '';
    }

    _render() {
        this._renderCatalog();
        // The layer tree displays the settings too
        document.dispatchEvent(new CustomEvent('lizmapcatalogchanged'));
    }

    _externalSettingsTemplate(serviceKey, name) {
        const entry = this._services.get(serviceKey);
        const state = entry?.group.children.find(item => item.name === name);
        if (!state) {
            return '';
        }
        const legend = entry.type === 'wms'
            ? withParams(serviceBaseUrl(entry.url), {
                SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetLegendGraphic', LAYER: name, FORMAT: 'image/png', SLD_VERSION: '1.1.0',
            })
            : '';
        return html`
        <div class="catalog-layer-settings">
            <label class="form-label">${lizDict['catalog.layer.opacity']}
                <input type="range" class="catalog-opacity form-range" min="0" max="100" step="10"
                    .value=${String(Math.round(state.opacity * 100))}
                    @input=${(e) => { state.opacity = Number(e.target.value) / 100; this._render(); }}>
            </label>
            ${legend ? html`<img class="catalog-legend" alt="" loading="lazy" src="${legend}">` : ''}
        </div>`;
    }

    _settingsTemplate(project, layer) {
        const state = this.layerState(project, layer);
        if (!state) {
            return '';
        }
        const style = state.olLayer.getSource().getParams().STYLES || '';
        return html`
        <div class="catalog-layer-settings">
            ${(layer.styles || []).length > 1 ? html`
                <label class="form-label">${lizDict['catalog.layer.style']}
                    <select class="catalog-style form-select form-select-sm"
                        @change=${(e) => this.setStyle(project, layer, e.target.value)}>
                        ${layer.styles.map(name => html`
                            <option value="${name}" ?selected=${style === name}>${name}</option>`)}
                    </select>
                </label>` : ''}
            <label class="form-label">${lizDict['catalog.layer.opacity']}
                <input type="range" class="catalog-opacity form-range" min="0" max="100" step="10"
                    .value=${String(Math.round(state.opacity * 100))}
                    @input=${(e) => { state.opacity = Number(e.target.value) / 100; this._render(); }}>
            </label>
            <img class="catalog-legend" alt="" loading="lazy" src="${this.legendUrl(project, layer, style)}">
            <p class="catalog-layer-info">
                ${layer.popup ? html`<span class="badge text-bg-secondary">${lizDict['catalog.layer.popup']}</span>` : ''}
                ${layer.attributeTable ? html`<button type="button" class="btn btn-sm catalog-table-open"
                    @click=${() => openCatalogTable(project, layer)}>
                    ${lizDict['catalog.layer.attributetable']}</button>` : ''}
            </p>
        </div>`;
    }

    _previewTemplate(project, layer) {
        const thumbnail = this.thumbnailUrl(project, layer);
        return html`
        <div class="catalog-layer-preview">
            ${thumbnail ? html`<img class="catalog-thumbnail" alt="${layer.title}" loading="lazy" src="${thumbnail}">` : ''}
            ${layer.abstract ? html`<p class="catalog-abstract">${layer.abstract}</p>` : ''}
            <dl>
                <dt>${lizDict['catalog.preview.map']}</dt><dd>${project.title}</dd>
                <dt>${lizDict['catalog.preview.type']}</dt>
                <dd>${layer.geometryType && layer.geometryType !== 'none'
                    ? layer.geometryType
                    : lizDict[layer.geometryType === 'none' ? 'catalog.preview.table' : 'catalog.preview.raster']}
                    ${layer.baseLayer ? html` (${lizDict['catalog.preview.baselayer']})` : ''}</dd>
                ${layer.crs ? html`<dt>${lizDict['catalog.preview.crs']}</dt><dd>${layer.crs}</dd>` : ''}
            </dl>
            ${this.hasExtent(layer) ? html`<button type="button" class="btn btn-sm catalog-zoom"
                @click=${() => this.zoomToLayer(layer)}>${lizDict['catalog.layer.zoom']}</button>` : ''}
            ${this._ai.enabled ? this._analysisTemplate(project, layer) : ''}
        </div>`;
    }

    _analysisTemplate(project, layer) {
        const id = project.key + '~' + layer.name;
        const analysis = this._analyses.get(id) || { question: '' };
        const data = analysis.data;
        return html`
        <div class="catalog-ai-analysis">
            <form class="catalog-ai-form" @submit=${(e) => { e.preventDefault(); this.analyseLayer(project, layer); }}>
                <input type="text" class="catalog-ai-layer-question form-control form-control-sm" maxlength="500"
                    placeholder="${lizDict['catalog.ai.question']}" .value=${analysis.question || ''}
                    @input=${(e) => { analysis.question = e.target.value; this._analyses.set(id, analysis); }}>
                <button type="submit" class="btn btn-sm catalog-ai-analyse" ?disabled=${analysis.loading}>
                    ${lizDict['catalog.ai.analyse']}</button>
            </form>
            ${analysis.loading ? html`<p class="catalog-loading">${lizDict['catalog.ai.analysing']}</p>` : ''}
            ${analysis.error ? this._errorTemplate(analysis.error) : ''}
            ${data ? html`
                <div class="catalog-ai-answer">
                    <p>${data.answer}</p>
                    ${data.highlights?.length ? html`<h5>${lizDict['catalog.ai.highlights']}</h5>
                        <ul>${data.highlights.map(item => html`<li>${item}</li>`)}</ul>` : ''}
                    ${data.suggestions?.length ? html`<h5>${lizDict['catalog.ai.suggestions']}</h5>
                        <ul>${data.suggestions.map(item => html`<li>${item}</li>`)}</ul>` : ''}
                    <p class="catalog-ai-source">${data.statistics
                        ? lizDict['catalog.ai.statistics'].replace('%s', data.statistics.features)
                        : lizDict['catalog.ai.nostatistics']}</p>
                </div>` : ''}
        </div>`;
    }

    /**
     * An assistant error, in simple words, with the technical message aside
     * @param {{reason: string, message: string}} error - the error
     * @returns {import('lit-html').TemplateResult} the template
     */
    _errorTemplate(error) {
        const text = lizDict['catalog.ai.error.' + error.reason] || lizDict['catalog.ai.error'];
        return html`
        <div class="catalog-error catalog-ai-error">
            <p>${text}</p>
            ${error.message ? html`<details><summary>${lizDict['catalog.ai.error.details']}</summary>
                <code>${error.message}</code></details>` : ''}
        </div>`;
    }

    /**
     * The AI assistant search form and results, displayed in the assistant dock
     * @returns {import('lit-html').TemplateResult} the template
     */
    assistantTemplate() {
        const ai = this._ai;
        return html`
        <div class="catalog-ai">
            <p class="catalog-ai-title">${lizDict['catalog.ai.title']}</p>
            <form class="catalog-ai-form" @submit=${(e) => { e.preventDefault(); this.searchWithAssistant(); }}>
                <textarea class="catalog-ai-question form-control form-control-sm" rows="2" maxlength="500"
                    placeholder="${lizDict['catalog.ai.placeholder']}" .value=${ai.question}
                    @input=${(e) => { ai.question = e.target.value; }}
                    @keydown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.searchWithAssistant(); } }}
                ></textarea>
                <button type="submit" class="btn btn-sm btn-primary catalog-ai-search" ?disabled=${ai.loading}>
                    ${lizDict['catalog.ai.search']}</button>
            </form>
            <p class="catalog-help">${lizDict['catalog.ai.notice']}</p>
            ${ai.loading ? html`<p class="catalog-loading">${lizDict['catalog.ai.searching']}</p>` : ''}
            ${ai.error ? this._errorTemplate(ai.error) : ''}
            ${ai.answer !== null ? html`
                <p class="catalog-ai-answer">${ai.answer}</p>
                ${ai.results.length === 0 ? html`<p>${lizDict['catalog.ai.noresult']}</p>` : ''}
                <ul class="catalog-layers catalog-ai-results">
                    ${ai.results.map(result => this._resultTemplate(result))}
                </ul>` : ''}
        </div>`;
    }

    _resultTemplate(result) {
        const key = result.repository + '~' + result.project;
        const loaded = this._projects.get(key);
        const layer = loaded?.layers?.find?.(l => l.name === result.name);
        const added = layer ? this.isAdded(loaded, layer) : false;
        const previewed = this._aiPreview === result.id;
        return html`
        <li class="catalog-layer catalog-ai-result ${added ? 'added' : ''} ${previewed ? 'previewed' : ''}">
            <span class="catalog-layer-title">${result.title}
                <small class="catalog-ai-map">${result.map}</small></span>
            <span class="catalog-layer-actions">
                <button type="button" class="btn btn-sm catalog-preview" title="${lizDict['catalog.layer.preview']}"
                    @click=${() => this.previewResult(result)}><i class="icon-info-sign"></i></button>
                ${added
                    ? html`<button type="button" class="btn btn-sm catalog-remove" title="${lizDict['catalog.layer.remove']}"
                        @click=${() => this.removeLayer(loaded, layer)}><i class="icon-remove"></i></button>`
                    : html`<button type="button" class="btn btn-sm btn-primary catalog-add" title="${lizDict['catalog.layer.add']}"
                        @click=${() => this.addResult(result)}><i class="icon-plus icon-white"></i></button>`}
            </span>
            ${result.reason ? html`<p class="catalog-ai-reason">${result.reason}</p>` : ''}
            ${previewed && layer ? this._previewTemplate(loaded, layer) : ''}
            ${previewed && loaded === 'loading' ? html`<p class="catalog-loading">${lizDict['catalog.loading']}</p>` : ''}
        </li>`;
    }

    _projectTemplate(repository, project) {
        project.key = repository.id + '~' + project.id;
        const loaded = this._projects.get(project.key);
        const layers = (loaded && loaded !== 'loading') ? loaded.layers.filter(
            l => this._match(l.title, l.abstract, project.title, project.abstract, ...(project.keywords || []))
        ) : null;
        if (layers && layers.length === 0 && this._filter) {
            return '';
        }
        if (!layers && !this._match(project.title, project.abstract, ...(project.keywords || []))) {
            return '';
        }
        return html`
        <details class="catalog-project" ?open=${!!this._filter && !!layers}
            @toggle=${(e) => { if (e.target.open) { this.loadProject(project); } }}>
            <summary title="${project.abstract}">${project.title}</summary>
            ${loaded === 'loading' ? html`<p class="catalog-loading">${lizDict['catalog.loading']}</p>` : ''}
            ${loaded?.error ? html`<p class="catalog-error">${lizDict['catalog.error']}</p>` : ''}
            ${layers ? html`
                ${layers.length === 0 ? html`<p>${lizDict['catalog.nolayer']}</p>` : ''}
                <ul class="catalog-layers">${layers.map(l => this._layerTemplate(loaded, l))}</ul>` : ''}
        </details>`;
    }

    _renderCatalog() {
        let content;
        if (this._repositories === null || this._repositories === 'loading') {
            content = html`<p class="catalog-loading">${lizDict['catalog.loading']}</p>`;
        } else if (this._error) {
            content = html`<p class="catalog-error">${lizDict['catalog.error']}</p>`;
        } else if (this._repositories.length === 0) {
            content = html`<p>${lizDict['catalog.noproject']}</p>`;
        } else {
            content = this._repositories.map(repository => html`
                <div class="catalog-repository">
                    <h4>${repository.title}</h4>
                    ${repository.projects.map(project => this._projectTemplate(repository, project))}
                </div>`);
        }
        render(html`
            <input type="search" class="catalog-filter form-control form-control-sm" placeholder="${lizDict['catalog.filter']}"
                .value=${this._filter}
                @input=${(e) => { this._filter = e.target.value.trim(); this._render(); }}>
            <p class="catalog-help">${lizDict['catalog.help']}</p>
            ${this._externalTemplate()}
            <div class="catalog-list">${content}</div>
        `, this);
    }
}
