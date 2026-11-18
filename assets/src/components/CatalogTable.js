/**
 * @module components/CatalogTable.js
 * @name CatalogTable
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainLizmap } from '../modules/Globals.js';
import { Utils } from '../modules/Utils.js';
import { html, render } from 'lit-html';
import DataTable from 'datatables.net-bs5';

import GeoJSON from 'ol/format/GeoJSON.js';
import { transformExtent } from 'ol/proj.js';
import { extend } from 'ol/extent.js';

/**
 * Open the attribute table of a catalog layer: in a tab of the attribute
 * table dock when the project has one, else in the catalog table dock.
 * @param {object} project - the loaded catalog project
 * @param {object} layer - the layer
 * @returns {Promise<void>}
 */
export function openCatalogTable(project, layer) {
    const tabs = document.getElementById('attributeLayers-tabs');
    const container = document.getElementById('attribute-table-container');
    if (!tabs || !container) {
        const li = document.querySelector('#mapmenu li.catalogtable');
        if (li && !li.classList.contains('active')) {
            document.getElementById('button-catalogtable')?.click();
        }
        return document.querySelector('lizmap-catalog-table')?.show(project, layer);
    }

    let pane = document.getElementById('attribute-catalog-table');
    let button = document.getElementById('nav-tab-attribute-catalog-table');
    if (!pane) {
        const tab = document.createElement('li');
        tab.className = 'nav-item';
        tab.setAttribute('role', 'presentation');
        tab.innerHTML = `<button id="nav-tab-attribute-catalog-table" class="nav-link" data-bs-toggle="tab"
            data-bs-target="#attribute-catalog-table" type="button" role="tab"><span class="title"></span>
            &nbsp;<i class="btn-close-catalog-tab icon-remove icon-white" style="cursor:pointer"></i></button>`;
        tabs.appendChild(tab);
        pane = document.createElement('div');
        pane.id = 'attribute-catalog-table';
        pane.className = 'tab-pane attribute-content bottom-content';
        pane.appendChild(document.createElement('lizmap-catalog-table'));
        container.appendChild(pane);
        button = tab.querySelector('button');
        button.addEventListener('shown.bs.tab', () => pane.querySelector('lizmap-catalog-table')?.refreshSize());
        tab.querySelector('.btn-close-catalog-tab').addEventListener('click', (e) => {
            e.stopPropagation();
            tab.remove();
            pane.remove();
            const summary = document.getElementById('nav-tab-attribute-summary');
            if (summary) {
                globalThis.bootstrap.Tab.getOrCreateInstance(summary).show();
            }
        });
    }
    button.querySelector('.title').textContent = layer.title;

    const li = document.querySelector('#mapmenu li.attributeLayers');
    if (li && !li.classList.contains('active')) {
        document.getElementById('button-attributeLayers')?.click();
    }
    globalThis.bootstrap.Tab.getOrCreateInstance(button).show();
    return pane.querySelector('lizmap-catalog-table').show(project, layer);
}

/** Maximum number of features read */
const MAX_FEATURES = 1000;

/**
 * Escape a text for HTML
 * @param {string} text - the text
 * @returns {string} the escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Read only attribute table of a layer added from the data catalog. The
 * features are read with the WFS of the source map, which checks the user
 * rights and the layer filters of the source project. The table is built
 * with DataTables, like the attribute table of the current project.
 * @class
 * @name CatalogTable
 * @augments HTMLElement
 */
export default class CatalogTable extends HTMLElement {
    constructor() {
        super();
        // {project, layer}
        this._source = null;
        this._features = [];
        this._loading = false;
        this._error = '';
        this._filter = '';
        this._extentOnly = false;
        this._truncated = false;
        this._dataTable = null;
    }

    connectedCallback() {
        this._render();
    }

    disconnectedCallback() {
        this._destroyTable();
    }

    /**
     * Display the attribute table of a catalog layer
     * @param {object} project - the loaded catalog project
     * @param {object} layer - the layer
     * @returns {Promise<void>}
     */
    async show(project, layer) {
        this._source = { project, layer };
        this._filter = '';
        await this.load();
    }

    /**
     * WFS GetFeature URL of the source layer
     * @returns {string} the URL
     */
    _getFeatureUrl() {
        const { project, layer } = this._source;
        const params = {
            SERVICE: 'WFS',
            VERSION: '1.0.0',
            REQUEST: 'GetFeature',
            TYPENAME: layer.typeName,
            OUTPUTFORMAT: 'GeoJSON',
            SRSNAME: 'EPSG:4326',
            MAXFEATURES: String(MAX_FEATURES + 1),
        };
        if (this._extentOnly) {
            const extent = transformExtent(
                mainLizmap.map.getView().calculateExtent(), mainLizmap.projection, 'EPSG:4326'
            );
            params.BBOX = extent.join(',');
        }
        const url = new URL(project.wmsUrl, window.location.href);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        return url.toString();
    }


    /**
     * Load the features
     * @returns {Promise<void>}
     */
    async load() {
        if (!this._source) {
            return;
        }
        this._loading = true;
        this._error = '';
        this._destroyTable();
        this._render();
        try {
            const response = await fetch(this._getFeatureUrl());
            if (!response.ok) {
                throw new Error(response.status + ' ' + response.statusText);
            }
            const data = await response.json();
            const features = Array.isArray(data.features) ? data.features : [];
            this._truncated = features.length > MAX_FEATURES;
            this._features = features.slice(0, MAX_FEATURES);
        } catch (error) {
            console.error(error);
            this._features = [];
            this._error = lizDict['catalog.table.error'] + ' (' + error.message + ')';
        }
        this._loading = false;
        this._render();
        if (!this._error) {
            this._buildTable();
        }
    }

    /** @type {string[]} The attribute names */
    get columns() {
        const columns = [];
        for (const feature of this._features.slice(0, 50)) {
            for (const key of Object.keys(feature.properties || {})) {
                if (!columns.includes(key)) {
                    columns.push(key);
                }
            }
        }
        return columns;
    }

    /** @type {object[]} The features matching the search of the table */
    get filteredFeatures() {
        if (!this._dataTable) {
            return this._features;
        }
        return this._dataTable.rows({ search: 'applied' }).data().toArray();
    }

    _destroyTable() {
        if (this._dataTable) {
            this._dataTable.destroy();
            this._dataTable = null;
        }
        const content = this.querySelector('.attribute-layer-content');
        if (content) {
            content.replaceChildren();
        }
    }

    /**
     * Build the DataTables table of the loaded features
     */
    _buildTable() {
        const content = this.querySelector('.attribute-layer-content');
        if (!content) {
            return;
        }
        const table = document.createElement('table');
        table.className = 'attribute-table-table table table-hover table-sm table-striped table-bordered';
        table.setAttribute('width', '100%');
        content.replaceChildren(table);

        const columns = [{
            title: '',
            data: null,
            orderable: false,
            searchable: false,
            className: 'lizmap-attribute-table-actions',
            render: (data, type, feature) => feature.geometry
                ? `<button type="button" class="btn btn-sm catalog-table-zoom" title="${escapeHtml(lizDict['catalog.table.zoom'])}"><i class="icon-zoom-in"></i></button>`
                : '',
        }];
        for (const name of this.columns) {
            columns.push({
                title: escapeHtml(name),
                // A function, as names may contain dots
                data: feature => feature.properties?.[name] ?? '',
                render: DataTable.render.text(),
            });
        }

        this._dataTable = new DataTable(table, {
            data: this._features,
            columns,
            order: columns.length > 1 ? [[1, 'asc']] : [],
            language: { url: globalThis['lizUrls']?.['dataTableLanguage'] },
            deferRender: true,
            pageLength: 50,
            scrollY: '95%',
            search: { search: this._filter },
            layout: {
                topStart: null,
                topEnd: null,
                bottomStart: ['info', 'pageLength'],
                bottomEnd: {
                    paging: {
                        firstLast: false
                    }
                },
            },
            initComplete: () => this.refreshSize(),
        });

        table.addEventListener('click', (event) => {
            const button = event.target.closest('button.catalog-table-zoom');
            if (button) {
                this.zoomToFeature(this._dataTable.row(button.closest('tr')).data());
            }
        });
    }

    /**
     * Adapt the table height to its container, like the attribute table
     */
    refreshSize() {
        const container = this.closest('[id]');
        if (container && globalThis.lizMap?.refreshDatatableSize) {
            globalThis.lizMap.refreshDatatableSize('#' + container.id);
        }
        this._dataTable?.columns.adjust();
    }

    /**
     * Zoom to a feature and highlight it
     * @param {object} feature - the GeoJSON feature
     */
    zoomToFeature(feature) {
        if (!feature?.geometry) {
            return;
        }
        const olFeature = new GeoJSON().readFeature(feature, {
            dataProjection: 'EPSG:4326',
            featureProjection: mainLizmap.projection,
        });
        mainLizmap.map.setHighlightFeatures(JSON.stringify(feature), 'geojson', 'EPSG:4326');
        mainLizmap.map.zoomToGeometryOrExtent(olFeature.getGeometry());
    }

    /**
     * Zoom to the extent of the features matching the search
     */
    zoomToFilteredFeatures() {
        const features = this.filteredFeatures.filter(feature => feature.geometry);
        if (!features.length) {
            return;
        }
        const olFeatures = new GeoJSON().readFeatures({ type: 'FeatureCollection', features }, {
            dataProjection: 'EPSG:4326',
            featureProjection: mainLizmap.projection,
        });
        const extent = olFeatures[0].getGeometry().getExtent().slice();
        for (const olFeature of olFeatures) {
            extend(extent, olFeature.getGeometry().getExtent());
        }
        mainLizmap.map.getView().fit(extent, { padding: [20, 20, 20, 20], maxZoom: 18 });
    }

    /**
     * Download the features matching the search
     * @param {string} format - CSV or GeoJSON
     */
    export(format) {
        const features = this.filteredFeatures;
        const name = this._source.layer.name || 'export';
        if (format === 'GeoJSON') {
            Utils.downloadFileFromString(
                JSON.stringify({ type: 'FeatureCollection', features }),
                'application/geo+json', name + '.geojson'
            );
            return;
        }
        const columns = this.columns;
        const escape = value => {
            const text = value === null || value === undefined ? '' : String(value);
            return /[",\n;]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        };
        const lines = [columns.map(escape).join(',')];
        for (const feature of features) {
            lines.push(columns.map(c => escape(feature.properties?.[c])).join(','));
        }
        Utils.downloadFileFromString(lines.join('\n'), 'text/csv', name + '.csv');
    }

    _render() {
        if (!this._source) {
            render(html`<p class="catalog-table-empty">${lizDict['catalog.table.empty']}</p>`, this);
            return;
        }
        const { project, layer } = this._source;
        const ready = !this._loading && !this._error;
        render(html`
            <div class="attribute-layer-main">
                <div class="attribute-layer-action-bar">
                    <button type="button" class="btn btn-sm" ?disabled=${!ready}
                        title="${lizDict['attributeLayers.toolbar.btn.fit.filtered.extent.title']}"
                        @click=${() => this.zoomToFilteredFeatures()}><i class="icon-fullscreen"></i></button>
                    <button type="button" class="btn-filterbyextent-attributeTable btn btn-sm ${this._extentOnly ? 'active' : ''}"
                        aria-pressed="${this._extentOnly}" title="${lizDict['attributeLayers.toolbar.btn.filterByExtent.title']}"
                        @click=${() => { this._extentOnly = !this._extentOnly; this.load(); }}>
                        <svg><use href="${globalThis['lizUrls']?.svgSprite}#filter-square"/></svg>
                    </button>
                    <button type="button" class="btn btn-sm" title="${lizDict['catalog.table.refresh']}"
                        @click=${() => this.load()}><i class="icon-refresh"></i></button>
                    <a class="btn btn-sm" href="${project.mapUrl}" target="_blank"
                        title="${lizDict['catalog.table.edit']}"><i class="icon-share"></i></a>
                    <span class="catalog-table-title">${layer.title} <small>(${project.title})</small></span>
                    ${this._loading ? html`<span class="attribute-layer-msg">${lizDict['catalog.loading']}</span>` : ''}
                    ${this._error ? html`<span class="attribute-layer-msg failure">${this._error}</span>` : ''}
                    ${this._truncated && ready ? html`<span class="attribute-layer-msg">${lizDict['catalog.table.truncated']}</span>` : ''}
                    <div class="export-formats dropdown float-end" role="group">
                        <button type="button" class="btn btn-sm dropdown-toggle" data-bs-toggle="dropdown"
                            aria-expanded="false" ?disabled=${!ready || !this._features.length}>
                            ${lizDict['attributeLayers.toolbar.btn.data.export.title']}
                        </button>
                        <ul class="dropdown-menu" role="menu">
                            ${['CSV', 'GeoJSON'].map(format => html`
                                <li><button type="button" class="dropdown-item"
                                    @click=${() => this.export(format)}>${format}</button></li>`)}
                        </ul>
                    </div>
                    <input type="search" class="form-control form-control-sm float-end catalog-table-filter"
                        placeholder="${lizDict['catalog.table.filter']}" .value=${this._filter} ?disabled=${!ready}
                        @input=${(e) => { this._filter = e.target.value; this._dataTable?.search(this._filter).draw(); }}>
                </div>
                <div class="attribute-layer-content"></div>
            </div>
        `, this);
    }
}
