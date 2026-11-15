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
        // External groups created by the catalog: "repo~project" => ExternalMapGroupState
        this._groups = new Map();
        // Preview: {project, layer}
        this._preview = null;
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
    }

    /**
     * Load the layers of a project
     * @param {object} project - the project from the catalog list
     * @returns {Promise<void>}
     */
    async loadProject(project) {
        const key = project.key;
        if (this._projects.has(key)) {
            return;
        }
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
     */
    addLayer(project, layer) {
        if (this.isAdded(project, layer)) {
            lizMap.addMessage(lizDict['catalog.layer.already'], 'info', true);
            return;
        }
        const olLayer = new ImageLayer({
            source: new ImageWMS({
                url: project.wmsUrl,
                params: {
                    LAYERS: layer.wmsName,
                    STYLES: '',
                    FORMAT: layer.imageFormat || 'image/png',
                    TRANSPARENT: true,
                },
                ratio: 1,
                projection: mainLizmap.projection,
            }),
        });
        olLayer.set('name', layer.name);

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
        this._render();
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
    zoomToLayer(layer) {
        if (!layer.extent || !layer.crs) {
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
        if (!layer.extent || !layer.crs || layer.extent.length !== 4) {
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
            ${previewed ? this._previewTemplate(project, layer) : ''}
        </li>`;
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
            ${layer.extent ? html`<button type="button" class="btn btn-sm catalog-zoom"
                @click=${() => this.zoomToLayer(layer)}>${lizDict['catalog.layer.zoom']}</button>` : ''}
        </div>`;
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

    _render() {
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
            <input type="search" class="catalog-filter form-control" placeholder="${lizDict['catalog.filter']}"
                .value=${this._filter}
                @input=${(e) => { this._filter = e.target.value.trim(); this._render(); }}>
            <p class="catalog-help">${lizDict['catalog.help']}</p>
            <div class="catalog-list">${content}</div>
        `, this);
    }
}
