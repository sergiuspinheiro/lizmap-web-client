/**
 * @module components/Catalog.js
 * @name Catalog
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';
import { html, render } from 'lit-html';

import ImageLayer from 'ol/layer/Image.js';
import ImageWMS from 'ol/source/ImageWMS.js';
import { transformExtent } from 'ol/proj.js';
import { openCatalogTable } from './CatalogTable.js';
import { SERVICE_TYPES, readService, createLayer, serviceBaseUrl, withParams } from '../modules/ExternalServices.js';
import { base64png } from '../modules/state/SymbologyIcons.js';
import { getDefaultLayerIcon } from '../modules/state/Symbology.js';
import { IMPORT_ACCEPT, readFiles, IMPORT_CRS, normalizeCrs } from '../modules/FileImport.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { createEmpty, extend, isEmpty } from 'ol/extent.js';
import { Utils } from '../modules/Utils.js';

/** Colors of the imported layers */
const IMPORT_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324'];

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
        // Files imported by the user, kept until the page is closed
        this._import = { loading: false, group: null, count: 0, over: false };
        // Files saved in the user profile: {canSave, quota, files} once read
        this._profile = null;
        // External services saved in the user profile, once read
        this._myServices = null;
        // Open sections of the catalog
        this._sections = new Set(['maps']);
        // AI assistant: status from the server, search and analyses
        this._ai = { enabled: false, analysis: false, question: '', loading: false, answer: null, results: [], error: false };
        // Layer analyses by "repo~project~layer": {loading, question, data, error}
        this._analyses = new Map();
        // Search result previewed: id
        this._aiPreview = null;
    }

    connectedCallback() {
        // Imported files of the map, once the map is ready
        this._restoreImportsHandler = () => this._restoreImports();
        mainEventDispatcher.addListener(this._restoreImportsHandler, 'lizmap.uicreated');

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
        mainEventDispatcher.removeListener(this._restoreImportsHandler, 'lizmap.uicreated');
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
            // Show where the data is
            this.zoomToLayer(found.layer);
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
     * Zoom to the features named by the assistant, e.g. a site name,
     * adding the layer to the map if needed
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @param {{text: string, feature: string}} highlight - the highlight of the analysis
     * @returns {Promise<void>}
     */
    async locateFeature(project, layer, highlight) {
        if (highlight.locating) {
            return;
        }
        highlight.locating = true;
        this._render();
        try {
            const data = await this._postAssistant(this.getAttribute('ai-locate-url'), {
                repository: project.repository,
                project: project.project,
                layer: layer.name,
                value: highlight.feature,
            });
            this.zoomToLocation(project, layer, data, highlight.feature);
        } catch (error) {
            console.error(error);
            lizMap.addMessage(lizDict['catalog.ai.locate.error'] + ' (' + error.message + ')', 'danger', true);
        }
        highlight.locating = false;
        this._render();
    }

    /**
     * Zoom to features found by the locate action, adding the layer to the map if needed
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @param {{count: number, extent: number[], crs: string}} location - the features found
     * @param {string} value - the searched value
     */
    zoomToLocation(project, layer, location, value) {
        if (!location?.count || !Array.isArray(location.extent)) {
            lizMap.addMessage(lizDict['catalog.ai.locate.none'].replace('%s', value), 'info', true);
            return;
        }
        if (!this.isAdded(project, layer)) {
            this.addLayer(project, layer);
        }
        let [xmin, ymin, xmax, ymax] = location.extent.map(Number);
        // A single point: show its surroundings
        const margin = 0.002;
        xmin -= margin; ymin -= margin; xmax += margin; ymax += margin;
        try {
            const extent = transformExtent([xmin, ymin, xmax, ymax], location.crs || 'EPSG:4326', mainLizmap.projection);
            mainLizmap.map.getView().fit(extent, { maxZoom: 18, padding: [40, 40, 40, 40] });
        } catch (error) {
            console.error(error);
        }
        if (location.count > 1) {
            lizMap.addMessage(lizDict['catalog.ai.locate.many'].replace('%s', location.count), 'info', true);
        }
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
    /**
     * Read the external services saved in the user profile
     * @returns {Promise<void>}
     */
    async loadMyServices() {
        if (!this._profileUrls?.services) {
            return;
        }
        try {
            this._myServices = await this._profileRequest(this._profileUrls.services);
        } catch (error) {
            console.warn(error);
            this._myServices = [];
        }
        this._render();
    }

    /**
     * Save the external service read in the user profile
     * @returns {Promise<void>}
     */
    async saveServiceToProfile() {
        const { type, url, service } = this._ext;
        try {
            await this._profileRequest(this._profileUrls.saveService, { type, url: url.trim(), title: service?.title || '' }, true);
            lizMap.addMessage(lizDict['catalog.external.profile.saved'], 'info', true);
        } catch (error) {
            lizMap.addMessage(lizDict['catalog.external.profile.error'] + ' (' + error.message + ')', 'danger', true);
        }
        await this.loadMyServices();
    }

    /**
     * Delete an external service saved in the user profile
     * @param {number} id - the saved service id
     * @returns {Promise<void>}
     */
    async deleteServiceFromProfile(id) {
        try {
            await this._profileRequest(this._profileUrls.deleteService, { id }, true);
        } catch (error) {
            lizMap.addMessage(lizDict['catalog.external.profile.error'] + ' (' + error.message + ')', 'danger', true);
        }
        await this.loadMyServices();
    }

    /**
     * Read a saved external service, to choose its layers
     * @param {{type: string, url: string}} saved - the saved service
     * @returns {Promise<void>}
     */
    openSavedService(saved) {
        this._ext.type = saved.type;
        this._ext.url = saved.url;
        return this.readExternalService();
    }

    _myServicesTemplate() {
        if (!this._profileUrls?.services || !this._myServices) {
            return '';
        }
        return html`
            <div class="catalog-import-profile">
                <h5>${lizDict['catalog.external.profile.title']}</h5>
                ${this._myServices.length === 0 ? html`<p class="catalog-help">${lizDict['catalog.external.profile.empty']}</p>` : html`
                    <ul class="catalog-layers">
                        ${this._myServices.map(saved => html`
                            <li class="catalog-layer">
                                <span class="catalog-layer-title" title="${saved.url}">${saved.title}
                                    <small>(${lizDict['catalog.external.type.' + saved.type] || saved.type})</small></span>
                                <span class="catalog-layer-actions">
                                    <button type="button" class="btn btn-sm" title="${lizDict['catalog.external.load']}"
                                        @click=${() => this.openSavedService(saved)}><i class="icon-folder-open"></i></button>
                                    <button type="button" class="btn btn-sm catalog-remove" title="${lizDict['catalog.import.profile.delete']}"
                                        @click=${() => this.deleteServiceFromProfile(saved.id)}><i class="icon-trash"></i></button>
                                </span>
                            </li>`)}
                    </ul>`}
            </div>`;
    }

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
        this._persistExternal();
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
        this._persistExternal();
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
        <div class="catalog-external">
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
                    ${service && this._profileUrls ? html`
                        <button type="button" class="btn btn-sm catalog-external-save"
                            title="${lizDict['catalog.external.profile.save']}"
                            @click=${() => this.saveServiceToProfile()}><i class="icon-hdd"></i></button>` : ''}
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
            ${this._myServicesTemplate()}
        </div>`;
    }

    /**
     * Import files selected or dropped by the user as temporary layers, in
     * an external group of the layer tree. They are not saved.
     * @param {FileList|File[]} fileList - the files
     * @returns {Promise<void>}
     */
    async importFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length || this._import.loading) {
            return;
        }
        this._import.loading = true;
        this._render();
        try {
            const { layers, errors, warnings } = await readFiles(
                files, mainLizmap.projection, fileName => this._askCrs(fileName)
            );
            for (const error of errors) {
                lizMap.addMessage(error, 'danger', true);
            }
            for (const warning of warnings) {
                lizMap.addMessage(warning, 'info', true);
            }
            if (!layers.length && !errors.length) {
                lizMap.addMessage(lizDict['catalog.import.empty'], 'info', true);
            }
            const extent = createEmpty();
            for (const layer of layers) {
                this._addImportedLayer(layer.name, layer.features);
                extend(extent, new VectorSource({ features: layer.features }).getExtent());
            }
            if (!isEmpty(extent)) {
                mainLizmap.map.getView().fit(extent, { padding: [20, 20, 20, 20], maxZoom: 18 });
            }
            this._persistImports();
        } finally {
            this._import.loading = false;
            this._render();
        }
    }

    /**
     * Ask the user the coordinate reference system of a file without one
     * @param {string} fileName - the file name
     * @returns {Promise<string|null>} the code like EPSG:3763, or null when cancelled
     */
    _askCrs(fileName) {
        this._sections.add('import');
        const known = IMPORT_CRS.some(crs => crs.code === mainLizmap.projection);
        return new Promise(resolve => {
            this._import.crsQuestion = {
                fileName,
                code: known ? mainLizmap.projection : IMPORT_CRS[0].code,
                other: '',
                invalid: false,
                resolve: code => {
                    this._import.crsQuestion = null;
                    this._render();
                    resolve(code);
                },
            };
            this._render();
        });
    }

    /**
     * Form asking the coordinate reference system of a file
     * @returns {import('lit-html').TemplateResult|string} the form
     */
    _crsQuestionTemplate() {
        const question = this._import.crsQuestion;
        if (!question) {
            return '';
        }
        const groups = [...new Set(IMPORT_CRS.map(crs => crs.group))];
        const submit = () => {
            const code = question.other.trim() ? normalizeCrs(question.other) : question.code;
            if (!code) {
                question.invalid = true;
                this._render();
                return;
            }
            question.resolve(code);
        };
        return html`
        <form class="catalog-import-crs alert alert-warning" @submit=${(e) => { e.preventDefault(); submit(); }}>
            <p>${lizDict['catalog.import.crs.question'].replace('%s', question.fileName)}</p>
            <select class="form-select form-select-sm" aria-label="${lizDict['catalog.import.crs.label']}"
                @change=${(e) => { question.code = e.target.value; }}>
                ${groups.map(group => html`
                    <optgroup label="${group === 'World' ? lizDict['catalog.import.crs.world'] : group}">
                        ${IMPORT_CRS.filter(crs => crs.group === group).map(crs => html`
                            <option value="${crs.code}" ?selected=${crs.code === question.code}>
                                ${crs.label} (${crs.code})</option>`)}
                    </optgroup>`)}
            </select>
            <input type="text" class="form-control form-control-sm ${question.invalid ? 'is-invalid' : ''}"
                placeholder="${lizDict['catalog.import.crs.other']}" .value=${question.other}
                @input=${(e) => { question.other = e.target.value; }}>
            ${question.invalid ? html`<div class="invalid-feedback">${lizDict['catalog.import.crs.invalid']}</div>` : ''}
            <div class="catalog-import-crs-actions">
                <button type="submit" class="btn btn-sm btn-primary">${lizDict['catalog.import.crs.apply']}</button>
                <button type="button" class="btn btn-sm" @click=${() => question.resolve(null)}>
                    ${lizDict['catalog.import.crs.cancel']}</button>
            </div>
        </form>`;
    }

    /**
     * Add an imported layer to the map
     * @param {string} title - the layer title
     * @param {import('ol/Feature.js').default[]} features - the features in the map projection
     * @param {number|null} [profileId] - the id of the file saved in the user profile
     */
    _addImportedLayer(title, features, profileId = null) {
        const color = IMPORT_COLORS[this._import.count % IMPORT_COLORS.length];
        ++this._import.count;
        // Saved files keep their name, so that the tree order of a map view applies
        const name = profileId ? 'profile-' + profileId : 'import-' + this._import.count;
        const olLayer = new VectorLayer({
            source: new VectorSource({ features }),
            style: {
                'fill-color': color + '40',
                'stroke-color': color,
                'stroke-width': 2,
                'circle-radius': 5,
                'circle-fill-color': color,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1,
            },
        });
        olLayer.set('name', name);
        olLayer.set('lizmapCatalog', { key: 'import|', name });
        olLayer.set('lizmapProfileId', profileId);
        if (!this._import.group) {
            this._import.group = mainLizmap.state.rootMapGroup.createExternalGroup('catalog-imports');
            this._import.group.wmsTitle = lizDict['catalog.import.group'];
        }
        const layerState = this._import.group.addOlLayer(name, olLayer);
        layerState.wmsTitle = title;
        const type = features.find(f => f.getGeometry())?.getGeometry().getType() || '';
        const geometryType = /Point/.test(type) ? 'point' : /Line/.test(type) ? 'line' : /Polygon/.test(type) ? 'polygon' : null;
        const icon = geometryType ? getDefaultLayerIcon({ type: 'layer', layerType: 'vector', geometryType }) : null;
        if (icon) {
            layerState.icon = icon;
        }
    }

    /**
     * Browser storage key of the imported files of the map
     * @param {string} kind - files or profile
     * @returns {string} the key
     */
    _importStorageKey(kind) {
        const params = globalThis.lizUrls?.params || {};
        return `lizmap-catalog-import-${kind}-${params.repository}-${params.project}`;
    }

    /**
     * Keep the imported files of the map in the browser: the temporary
     * files until the browser tab is closed, the ids of the files saved in
     * the profile for the next visits.
     */
    _persistImports() {
        const layers = [...(this._import.group?.children || [])].reverse();
        const format = new GeoJSON();
        const files = layers
            .filter(item => !item.olLayer.get('lizmapProfileId'))
            .map(item => ({
                title: item.wmsTitle,
                geojson: format.writeFeaturesObject(item.olLayer.getSource().getFeatures(), {
                    dataProjection: 'EPSG:4326',
                    featureProjection: mainLizmap.projection,
                    decimals: 7,
                }),
            }));
        try {
            if (files.length) {
                window.sessionStorage.setItem(this._importStorageKey('files'), JSON.stringify(files));
            } else {
                window.sessionStorage.removeItem(this._importStorageKey('files'));
            }
        } catch (error) {
            // Too big for the browser storage: the files are lost on reload
            console.warn(error);
            try {
                window.sessionStorage.removeItem(this._importStorageKey('files'));
            } catch {
                // No storage
            }
        }
        try {
            const ids = this.profileLayers;
            if (ids.length) {
                window.localStorage.setItem(this._importStorageKey('profile'), JSON.stringify(ids));
            } else {
                window.localStorage.removeItem(this._importStorageKey('profile'));
            }
        } catch (error) {
            console.warn(error);
        }
    }

    /**
     * Keep the layers of external services of the map until the browser tab is closed
     */
    _persistExternal() {
        if (this._restoringExternal) {
            return;
        }
        try {
            const layers = this.externalLayers;
            if (layers.length) {
                window.sessionStorage.setItem(this._importStorageKey('external'), JSON.stringify(layers));
            } else {
                window.sessionStorage.removeItem(this._importStorageKey('external'));
            }
        } catch (error) {
            console.warn(error);
        }
    }

    /**
     * Add again the imported files of the map after a reload
     * @returns {Promise<void>}
     */
    async _restoreImports() {
        if (this._importsRestored) {
            return;
        }
        this._importsRestored = true;
        try {
            const external = JSON.parse(window.sessionStorage.getItem(this._importStorageKey('external')) || '[]');
            if (Array.isArray(external) && external.length) {
                this._restoringExternal = true;
                await this.restoreExternal(external);
            }
        } catch (error) {
            console.warn(error);
        } finally {
            this._restoringExternal = false;
            this._persistExternal();
        }
        let files = [];
        let ids = [];
        try {
            files = JSON.parse(window.sessionStorage.getItem(this._importStorageKey('files')) || '[]');
            ids = JSON.parse(window.localStorage.getItem(this._importStorageKey('profile')) || '[]');
        } catch (error) {
            console.warn(error);
        }
        if (this._profileUrls) {
            for (const id of (Array.isArray(ids) ? ids : [])) {
                if (Number.isInteger(id)) {
                    await this.addFromProfile(id, false);
                }
            }
        }
        for (const file of (Array.isArray(files) ? files : [])) {
            try {
                const features = new GeoJSON().readFeatures(file.geojson, {
                    dataProjection: 'EPSG:4326',
                    featureProjection: mainLizmap.projection,
                });
                if (features.length) {
                    this._addImportedLayer(String(file.title || ''), features);
                }
            } catch (error) {
                console.warn(error);
            }
        }
        this._persistImports();
        this._render();
    }

    /** @type {object|undefined} URLs of the files saved in the user profile, for connected users */
    get _profileUrls() {
        return globalThis.lizUrls?.userImports;
    }

    async _profileRequest(url, extra = {}, post = false) {
        const params = new URLSearchParams({ ...globalThis.lizUrls.params, ...extra });
        const response = post
            ? await fetch(url, { method: 'POST', body: params })
            : await fetch(url + '?' + params.toString());
        if (!response.ok) {
            let message = response.statusText;
            if (response.status === 413) {
                message = lizDict['catalog.import.profile.quota'];
            } else {
                try {
                    message = (await response.json()).error || message;
                } catch {
                    // Not a JSON response
                }
            }
            throw new Error(message);
        }
        return response.json();
    }

    /**
     * Read the files saved in the user profile and the quota
     * @returns {Promise<void>}
     */
    async loadProfile() {
        if (!this._profileUrls) {
            return;
        }
        try {
            this._profile = await this._profileRequest(this._profileUrls.list);
        } catch (error) {
            console.warn(error);
            this._profile = null;
        }
        this._render();
    }

    /**
     * Save an imported layer in the user profile
     * @param {object} state - the layer state
     * @returns {Promise<void>}
     */
    async saveToProfile(state) {
        const olLayer = state.olLayer;
        const geojson = new GeoJSON().writeFeatures(olLayer.getSource().getFeatures(), {
            dataProjection: 'EPSG:4326',
            featureProjection: mainLizmap.projection,
            decimals: 7,
        });
        try {
            const file = await this._profileRequest(this._profileUrls.save, { title: state.wmsTitle, geojson }, true);
            olLayer.set('lizmapProfileId', file.id);
            this._persistImports();
            lizMap.addMessage(lizDict['catalog.import.profile.saved'], 'info', true);
        } catch (error) {
            lizMap.addMessage(lizDict['catalog.import.profile.error'] + ' (' + error.message + ')', 'danger', true);
        }
        await this.loadProfile();
    }

    /**
     * State of the layer of a saved file in the map
     * @param {number} id - the saved file id
     * @returns {object|undefined} the layer state
     */
    _profileLayerState(id) {
        return this._import.group?.children.find(item => item.olLayer.get('lizmapProfileId') === id);
    }

    /**
     * Add a file saved in the user profile to the map
     * @param {number} id - the saved file id
     * @param {boolean} [zoom] - zoom to the layer
     * @returns {Promise<void>}
     */
    async addFromProfile(id, zoom = true) {
        if (this._profileLayerState(id)) {
            return;
        }
        try {
            const file = await this._profileRequest(this._profileUrls.get, { id });
            const features = new GeoJSON().readFeatures(file.geojson, {
                dataProjection: 'EPSG:4326',
                featureProjection: mainLizmap.projection,
            });
            this._addImportedLayer(file.title, features, file.id);
            this._persistImports();
            const state = this._profileLayerState(file.id);
            if (zoom && state) {
                this._zoomToImported(state);
            }
        } catch (error) {
            lizMap.addMessage(lizDict['catalog.import.profile.error'] + ' (' + error.message + ')', 'danger', true);
        }
        this._render();
    }

    /**
     * Delete a file saved in the user profile, the layer stays in the map until the page is closed
     * @param {number} id - the saved file id
     * @returns {Promise<void>}
     */
    async deleteFromProfile(id) {
        try {
            await this._profileRequest(this._profileUrls.delete, { id }, true);
            this._profileLayerState(id)?.olLayer.set('lizmapProfileId', null);
            this._persistImports();
        } catch (error) {
            lizMap.addMessage(lizDict['catalog.import.profile.error'] + ' (' + error.message + ')', 'danger', true);
        }
        await this.loadProfile();
    }

    /**
     * Ids of the saved files in the map, to save them in a map view
     * @type {number[]}
     */
    get profileLayers() {
        return (this._import.group?.children || [])
            .map(item => item.olLayer.get('lizmapProfileId'))
            .filter(id => id)
            .reverse();
    }

    /**
     * Replace the saved files in the map by the ones of a map view
     * @param {number[]} ids - the saved file ids
     * @returns {Promise<void>}
     */
    async restoreProfile(ids) {
        for (const item of [...(this._import.group?.children || [])]) {
            if (item.olLayer.get('lizmapProfileId')) {
                this.removeImportedLayer(item.name);
            }
        }
        for (const id of (Array.isArray(ids) ? ids : [])) {
            if (Number.isInteger(id) && this._profileUrls) {
                await this.addFromProfile(id, false);
            }
        }
    }

    _profileTemplate() {
        const profile = this._profile;
        if (!this._profileUrls || !profile) {
            return '';
        }
        const used = profile.files.reduce((total, file) => total + file.size, 0);
        const mb = bytes => (bytes / 1024 / 1024).toFixed(1);
        return html`
            <div class="catalog-import-profile">
                <h5>${lizDict['catalog.import.profile.title']}</h5>
                ${profile.canSave ? '' : html`<p class="catalog-help">${lizDict['catalog.import.profile.notallowed']}</p>`}
                <p class="catalog-help">
                    ${lizDict['catalog.import.profile.quota.used']
                        .replace('%1', mb(used)).replace('%2', mb(profile.quota.size))
                        .replace('%3', profile.files.length).replace('%4', profile.quota.layers)}
                </p>
                ${profile.files.length ? html`
                    <ul class="catalog-layers">
                        ${profile.files.map(file => {
                            const added = !!this._profileLayerState(file.id);
                            return html`
                            <li class="catalog-layer ${added ? 'added' : ''}">
                                <span class="catalog-layer-title">${file.title} <small>(${mb(file.size)} MB)</small></span>
                                <span class="catalog-layer-actions">
                                    ${added ? '' : html`<button type="button" class="btn btn-sm btn-primary catalog-add"
                                        title="${lizDict['catalog.layer.add']}"
                                        @click=${() => this.addFromProfile(file.id)}><i class="icon-plus icon-white"></i></button>`}
                                    <button type="button" class="btn btn-sm catalog-remove" title="${lizDict['catalog.import.profile.delete']}"
                                        @click=${() => this.deleteFromProfile(file.id)}><i class="icon-trash"></i></button>
                                </span>
                            </li>`;
                        })}
                    </ul>` : ''}
            </div>`;
    }

    /**
     * Remove an imported layer
     * @param {string} name - the layer name
     */
    removeImportedLayer(name) {
        const group = this._import.group;
        if (!group) {
            return;
        }
        group.removeOlLayer(name);
        if (group.childrenCount === 0) {
            mainLizmap.state.rootMapGroup.removeExternalGroup(group.name);
            this._import.group = null;
        }
        this._persistImports();
        this._render();
    }

    /**
     * Zoom to an imported layer
     * @param {object} state - the layer state
     */
    _zoomToImported(state) {
        const extent = state.olLayer.getSource().getExtent();
        if (!isEmpty(extent)) {
            mainLizmap.map.getView().fit(extent, { padding: [20, 20, 20, 20], maxZoom: 18 });
        }
    }

    _importTemplate() {
        const imp = this._import;
        const layers = imp.group ? imp.group.children : [];
        const canSave = this._profile?.canSave;
        return html`
        <div class="catalog-import">
            <div class="catalog-import-drop ${imp.over ? 'over' : ''}"
                @dragover=${(e) => {
                    if (e.dataTransfer?.types?.includes('Files')) {
                        e.preventDefault();
                        if (!imp.over) { imp.over = true; this._renderCatalog(); }
                    }
                }}
                @dragleave=${() => { imp.over = false; this._renderCatalog(); }}
                @drop=${(e) => {
                    e.preventDefault();
                    imp.over = false;
                    this.importFiles(e.dataTransfer?.files);
                }}>
                <p class="catalog-help">${lizDict['catalog.import.help']}</p>
                <input type="file" multiple class="form-control form-control-sm catalog-import-file"
                    accept="${IMPORT_ACCEPT}" ?disabled=${imp.loading}
                    @change=${(e) => { this.importFiles(e.target.files).then(() => { e.target.value = ''; }); }}>
            </div>
            ${this._crsQuestionTemplate()}
            ${imp.loading && !imp.crsQuestion ? html`<p class="catalog-loading">${lizDict['catalog.loading']}</p>` : ''}
            ${layers.length ? html`
                <ul class="catalog-layers">
                    ${layers.map(state => html`
                        <li class="catalog-layer added">
                            <span class="catalog-layer-title">${state.wmsTitle}
                                <small>(${state.olLayer.getSource().getFeatures().length})</small></span>
                            <span class="catalog-layer-actions">
                                <button type="button" class="btn btn-sm" title="${lizDict['catalog.layer.zoom']}"
                                    @click=${() => this._zoomToImported(state)}><i class="icon-zoom-in"></i></button>
                                ${canSave && !state.olLayer.get('lizmapProfileId') ? html`
                                    <button type="button" class="btn btn-sm catalog-import-save"
                                        title="${lizDict['catalog.import.profile.save']}"
                                        @click=${() => this.saveToProfile(state)}><i class="icon-hdd"></i></button>` : ''}
                                <button type="button" class="btn btn-sm catalog-remove" title="${lizDict['catalog.layer.remove']}"
                                    @click=${() => this.removeImportedLayer(state.name)}><i class="icon-remove"></i></button>
                            </span>
                        </li>`)}
                </ul>` : ''}
            ${this._profileTemplate()}
        </div>`;
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
        <li class="catalog-layer ${added ? 'added' : ''} ${previewed ? 'previewed' : ''}">
            <span class="catalog-layer-title catalog-layer-drag" draggable="true"
                title="${lizDict['catalog.layer.drag']}"
                @dragstart=${(e) => {
                    e.dataTransfer.setData(CATALOG_DRAG_TYPE, JSON.stringify({ key: project.key, name: layer.name }));
                    e.dataTransfer.effectAllowed = 'copy';
                }}>${layer.title}</span>
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
        if (key === 'import|') {
            const state = this._import.group?.children.find(item => item.name === name);
            return state ? this._opacityTemplate(state) : '';
        }
        if (key.startsWith('external|')) {
            return this._externalSettingsTemplate(key.substring('external|'.length), name);
        }
        const project = this._projects.get(key);
        const layer = project?.layers?.find(l => l.name === name);
        return layer ? this._settingsTemplate(project, layer) : '';
    }

    /**
     * Show the information of a layer added by the catalog in the sub-dock,
     * like the layers of the project, with its origin
     * @param {string} key - the catalog key: project key, 'import|' or 'external|<service>'
     * @param {string} name - the layer name
     */
    showLayerInfo(key, name) {
        if (this._info?.key === key && this._info?.name === name) {
            this.hideLayerInfo();
            return;
        }
        // Unselect the layer of the project whose information is displayed
        const treeview = document.querySelector('lizmap-treeview');
        if (treeview?.itemNameSelected !== undefined) {
            treeview.itemNameSelected = undefined;
        }
        if (!this._infoListening && globalThis.lizMap?.events) {
            this._infoListening = true;
            // The sub-dock displays then a layer of the project
            lizMap.events.on({ lizmapswitcheritemselected: (e) => {
                if (e.selected) {
                    this._info = null;
                    document.dispatchEvent(new CustomEvent('lizmapcatalogchanged'));
                }
            } });
        }
        this._info = { key, name };
        this._renderInfo();
        document.dispatchEvent(new CustomEvent('lizmapcatalogchanged'));
    }

    /**
     * Hide the information of a layer added by the catalog
     */
    hideLayerInfo() {
        if (!this._info) {
            return;
        }
        this._info = null;
        const subDock = document.getElementById('sub-dock');
        if (subDock && this._infoContainer && subDock.contains(this._infoContainer)) {
            subDock.replaceChildren();
            subDock.style.display = 'none';
        }
        document.dispatchEvent(new CustomEvent('lizmapcatalogchanged'));
    }

    /**
     * Is the information of a layer displayed
     * @param {string} key - the catalog key
     * @param {string} name - the layer name
     * @returns {boolean} true if displayed
     */
    isInfoShown(key, name) {
        return this._info?.key === key && this._info?.name === name;
    }

    _renderInfo() {
        const subDock = document.getElementById('sub-dock');
        if (!this._info || !subDock) {
            return;
        }
        const template = this._layerInfoTemplate(this._info.key, this._info.name);
        if (!template) {
            this.hideLayerInfo();
            return;
        }
        // The sub-dock content is replaced by the information of the project layers:
        // render in a container of our own
        if (!this._infoContainer || !subDock.contains(this._infoContainer)) {
            this._infoContainer = document.createElement('div');
            this._infoContainer.className = 'catalog-layer-metadata';
            subDock.replaceChildren(this._infoContainer);
        }
        render(template, this._infoContainer);
        subDock.style.display = 'block';
    }

    /**
     * Information of a layer added by the catalog, with the markup of the layers of the project
     * @param {string} key - the catalog key
     * @param {string} name - the layer name
     * @returns {import('lit-html').TemplateResult|null} the template, null if the layer is removed
     */
    _layerInfoTemplate(key, name) {
        let state = null;
        let origin;
        let details;
        let zoom = null;
        let styles = '';
        let exportGeoJson = null;
        let abstract = '';
        let table = null;
        if (key === 'import|') {
            state = this._import.group?.children.find(item => item.name === name);
            if (!state) {
                return null;
            }
            const source = state.olLayer.getSource();
            origin = lizDict['catalog.info.origin.import']
                + (state.olLayer.get('lizmapProfileId') ? ' (' + lizDict['catalog.info.origin.profile'] + ')' : '');
            details = [[lizDict['catalog.info.features'], String(source.getFeatures().length)]];
            zoom = () => this._zoomToImported(state);
            exportGeoJson = () => Utils.downloadFileFromString(
                new GeoJSON().writeFeatures(source.getFeatures(), { featureProjection: mainLizmap.projection }),
                'application/geo+json', (state.wmsTitle || 'import') + '.geojson'
            );
        } else if (key.startsWith('external|')) {
            const entry = this._services.get(key.substring('external|'.length));
            state = entry?.group.children.find(item => item.name === name);
            if (!state) {
                return null;
            }
            origin = lizDict['catalog.info.origin.external'].replace('%s', entry.type.toUpperCase());
            details = [
                [lizDict['catalog.info.service'], entry.title || ''],
                [lizDict['catalog.info.url'], entry.url],
            ];
            const extent = state.olLayer.getSource?.()?.getExtent?.() || state.olLayer.getExtent?.();
            if (extent && !isEmpty(extent) && extent.every(Number.isFinite)) {
                zoom = () => mainLizmap.map.getView().fit(extent, { padding: [20, 20, 20, 20], maxZoom: 18 });
            }
        } else {
            const project = this._projects.get(key);
            const layer = project?.layers?.find(l => l.name === name);
            state = layer ? this.layerState(project, layer) : null;
            if (!state) {
                return null;
            }
            origin = lizDict['catalog.info.origin.catalog'];
            details = [[lizDict['catalog.info.map'], html`<a href="${project.mapUrl}" target="_blank"
                rel="noopener">${project.title}</a>`]];
            if (this.hasExtent(layer)) {
                zoom = () => this.zoomToLayer(layer);
            }
            if ((layer.styles || []).length > 1) {
                const current = state.olLayer.getSource().getParams().STYLES || '';
                styles = html`
                    <dt>${lizDict['layer.metadata.style.title']}</dt>
                    <dd><select class="styleLayer form-select"
                        @change=${(e) => this.setStyle(project, layer, e.target.value)}>
                        ${layer.styles.map(style => html`<option value="${style}" ?selected=${current === style}>${style}</option>`)}
                    </select></dd>`;
            }
            abstract = layer.abstract || '';
            if (layer.attributeTable) {
                table = () => openCatalogTable(project, layer);
            }
        }
        const opacities = globalThis.lizMap?.config?.options?.layersOpacities || [0.2, 0.4, 0.6, 0.8, 1];
        return html`
        <div class="sub-metadata">
            <h3><span class="title"><span class="icon"></span>
                <span class="text">${lizDict['layer.metadata.title']}</span></span></h3>
            <div class="menu-content">
                <dl style="font-size:0.8em;">
                    <dt>${lizDict['layer.metadata.layer.name']}</dt>
                    <dd>${state.wmsTitle || name}</dd>
                    <dt>${lizDict['layer.metadata.layer.type']}</dt>
                    <dd>${lizDict['layer.metadata.layer.type.layer']}</dd>
                    <dt>${lizDict['catalog.info.origin']}</dt>
                    <dd><span class="badge text-bg-secondary">${origin}</span></dd>
                    ${details.map(([label, value]) => html`<dt>${label}</dt><dd class="text-break">${value}</dd>`)}
                    ${zoom ? html`
                        <dt>${lizDict['layer.metadata.zoomToExtent.title']}</dt>
                        <dd><button type="button" class="btn btn-sm layerActionZoom"
                            title="${lizDict['layer.metadata.zoomToExtent.title']}" @click=${zoom}>
                            <i class="icon-zoom-in"></i></button></dd>` : ''}
                    ${styles}
                    <dt>${lizDict['layer.metadata.opacity.title']}</dt>
                    <dd>${opacities.map(opacity => html`<a href="#"
                        class="btn btn-sm btn-opacity-layer ${Math.abs(state.opacity - opacity) < 0.001 ? 'active' : ''}"
                        style="background-color: rgba(0,0,0,${opacity - 0.3}); background-image: none; text-shadow: none;
                            ${opacity > 0.6 ? 'color: lightgrey;' : ''}"
                        @click=${(e) => { e.preventDefault(); state.opacity = opacity; this._render(); }}>
                        ${Math.round(opacity * 100)}</a>`)}</dd>
                    ${exportGeoJson ? html`
                        <dt>${lizDict['layer.metadata.export.title']}</dt>
                        <dd><button type="button" class="btn btn-sm exportLayer"
                            title="${lizDict['layer.metadata.export.title']} GeoJSON" @click=${exportGeoJson}>
                            <i class="icon-download"></i> GeoJSON</button></dd>` : ''}
                    ${table ? html`
                        <dt>${lizDict['catalog.layer.attributetable']}</dt>
                        <dd><button type="button" class="btn btn-sm catalog-table-open" @click=${table}>
                            <i class="icon-list"></i></button></dd>` : ''}
                    ${abstract ? html`
                        <dt>${lizDict['layer.metadata.layer.abstract']}</dt>
                        <dd>${abstract}</dd>` : ''}
                </dl>
            </div>
        </div>
        <button type="button" class="btn btn-sm float-end" title="${lizDict['generic.btn.close.title']}"
            @click=${() => this.hideLayerInfo()}>${lizDict['generic.btn.close.title']}</button>`;
    }

    _render() {
        this._renderCatalog();
        this._renderInfo();
        // The layer tree displays the settings too
        document.dispatchEvent(new CustomEvent('lizmapcatalogchanged'));
    }

    _opacityTemplate(state) {
        return html`
        <div class="catalog-layer-settings">
            <label class="form-label">${lizDict['catalog.layer.opacity']}
                <input type="range" class="catalog-opacity form-range" min="0" max="100" step="10"
                    .value=${String(Math.round(state.opacity * 100))}
                    @input=${(e) => { state.opacity = Number(e.target.value) / 100; this._render(); }}>
            </label>
        </div>`;
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
                    ${data.feature && data.location ? html`<p class="catalog-ai-location">${data.location.count
                        ? html`<button type="button" class="btn btn-sm catalog-ai-locate"
                            @click=${() => this.zoomToLocation(project, layer, data.location, data.feature)}>
                            <i class="icon-zoom-in"></i> ${lizDict['catalog.ai.locate']} : ${data.feature}
                            ${data.location.count > 1 ? '(' + data.location.count + ')' : ''}</button>`
                        : lizDict['catalog.ai.locate.none'].replace('%s', data.feature)}</p>` : ''}
                    ${data.highlights?.length ? html`<h5>${lizDict['catalog.ai.highlights']}</h5>
                        <ul>${data.highlights.map(item => this._highlightTemplate(project, layer, item))}</ul>` : ''}
                    ${data.suggestions?.length ? html`<h5>${lizDict['catalog.ai.suggestions']}</h5>
                        <ul>${data.suggestions.map(item => html`<li>${item}</li>`)}</ul>` : ''}
                    <p class="catalog-ai-source">${data.statistics
                        ? lizDict['catalog.ai.statistics'].replace('%s', data.statistics.features)
                        : lizDict['catalog.ai.nostatistics']}</p>
                </div>` : ''}
        </div>`;
    }

    /**
     * A highlight of the analysis, with a button to zoom to the features it names
     * @param {object} project - the loaded project
     * @param {object} layer - the layer
     * @param {{text: string, feature: string}|string} item - the highlight
     * @returns {import('lit-html').TemplateResult} the template
     */
    _highlightTemplate(project, layer, item) {
        if (typeof item === 'string') {
            return html`<li>${item}</li>`;
        }
        const canLocate = item.feature && this.getAttribute('ai-locate-url') && this.hasExtent(layer);
        return html`<li>${item.text}
            ${canLocate ? html`<button type="button" class="btn btn-sm catalog-ai-locate" ?disabled=${item.locating}
                title="${lizDict['catalog.ai.locate'] + ' : ' + item.feature}"
                @click=${() => this.locateFeature(project, layer, item)}><i class="icon-zoom-in"></i>
                ${lizDict['catalog.ai.locate']}</button>` : ''}</li>`;
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

    /**
     * Collapsible section of the catalog, a Bootstrap accordion item
     * @param {string} id - the section id
     * @param {string} title - the section title
     * @param {string} icon - the icon class
     * @param {Function} content - gives the section content
     * @returns {import('lit-html').TemplateResult} the template
     */
    _sectionTemplate(id, title, icon, content) {
        const open = this._sections.has(id);
        return html`
        <div class="accordion-item catalog-section catalog-section-${id}">
            <h2 class="accordion-header">
                <button type="button" class="accordion-button ${open ? '' : 'collapsed'}" aria-expanded="${open}"
                    @click=${() => this._toggleSection(id)}>
                    <i class="${icon}"></i>&nbsp;${title}
                </button>
            </h2>
            ${open ? html`<div class="accordion-collapse collapse show"><div class="accordion-body">${content()}</div></div>` : ''}
        </div>`;
    }

    _toggleSection(id) {
        if (this._sections.has(id)) {
            this._sections.delete(id);
        } else {
            this._sections.add(id);
            if (id === 'import' && this._profile === null) {
                this.loadProfile();
            }
            if (id === 'external' && this._myServices === null) {
                this.loadMyServices();
            }
        }
        this._renderCatalog();
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
                    <h4><i class="icon-folder-open"></i>${repository.title}</h4>
                    ${repository.projects.map(project => this._projectTemplate(repository, project))}
                </div>`);
        }
        render(html`
            <input type="search" class="catalog-filter form-control form-control-sm" placeholder="${lizDict['catalog.filter']}"
                .value=${this._filter}
                @input=${(e) => { this._filter = e.target.value.trim(); this._render(); }}>
            <div class="accordion catalog-sections">
                ${this._sectionTemplate('external', lizDict['catalog.external.title'], 'icon-globe', () => this._externalTemplate())}
                ${this._sectionTemplate('import', lizDict['catalog.import.title'], 'icon-upload', () => this._importTemplate())}
                ${this._sectionTemplate('maps', lizDict['catalog.maps.title'], 'icon-th-list', () => html`
                    <p class="catalog-help">${lizDict['catalog.help']}</p>
                    <div class="catalog-list">${content}</div>`)}
            </div>
        `, this);
    }
}
