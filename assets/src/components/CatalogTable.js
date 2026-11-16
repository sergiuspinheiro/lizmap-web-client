/**
 * @module components/CatalogTable.js
 * @name CatalogTable
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainLizmap } from '../modules/Globals.js';
import { Utils } from '../modules/Utils.js';
import { html, render } from 'lit-html';

import GeoJSON from 'ol/format/GeoJSON.js';
import { transformExtent } from 'ol/proj.js';

/** Maximum number of features read */
const MAX_FEATURES = 1000;

/** Rows displayed per page */
const PAGE_SIZE = 50;

/**
 * Read only attribute table of a layer added from the data catalog. The
 * features are read with the WFS of the source map, which checks the user
 * rights and the layer filters of the source project.
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
        this._page = 0;
        this._extentOnly = false;
        this._truncated = false;
    }

    connectedCallback() {
        this._render();
    }

    /**
     * Display the attribute table of a catalog layer, in the bottom dock
     * @param {object} project - the loaded catalog project
     * @param {object} layer - the layer
     * @returns {Promise<void>}
     */
    async open(project, layer) {
        this._source = { project, layer };
        this._filter = '';
        this._page = 0;
        const li = document.querySelector('#mapmenu li.catalogtable');
        if (li && !li.classList.contains('active')) {
            document.getElementById('button-catalogtable')?.click();
        }
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
        this._page = 0;
        this._render();
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

    /** @type {object[]} The features matching the text filter */
    get filteredFeatures() {
        if (!this._filter) {
            return this._features;
        }
        const filter = this._filter.toLowerCase();
        return this._features.filter(feature => Object.values(feature.properties || {})
            .some(value => value !== null && String(value).toLowerCase().includes(filter)));
    }

    /**
     * Zoom to a feature and highlight it
     * @param {object} feature - the GeoJSON feature
     */
    zoomToFeature(feature) {
        if (!feature.geometry) {
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
     * Download the filtered features as CSV
     */
    exportCsv() {
        const columns = this.columns;
        const escape = value => {
            const text = value === null || value === undefined ? '' : String(value);
            return /[",\n;]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        };
        const lines = [columns.map(escape).join(',')];
        for (const feature of this.filteredFeatures) {
            lines.push(columns.map(c => escape(feature.properties?.[c])).join(','));
        }
        Utils.downloadFileFromString(lines.join('\n'), 'text/csv', (this._source.layer.name || 'export') + '.csv');
    }

    _render() {
        if (!this._source) {
            render(html`<p class="catalog-table-empty">${lizDict['catalog.table.empty']}</p>`, this);
            return;
        }
        const { project, layer } = this._source;
        const columns = this.columns;
        const features = this.filteredFeatures;
        const pages = Math.max(1, Math.ceil(features.length / PAGE_SIZE));
        const page = Math.min(this._page, pages - 1);
        const rows = features.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        render(html`
            <div class="catalog-table-toolbar">
                <h4>${layer.title} <small>(${project.title})</small></h4>
                <input type="search" class="form-control form-control-sm catalog-table-filter"
                    placeholder="${lizDict['catalog.table.filter']}" .value=${this._filter}
                    @input=${(e) => { this._filter = e.target.value.trim(); this._page = 0; this._render(); }}>
                <label class="catalog-table-extent">
                    <input type="checkbox" .checked=${this._extentOnly}
                        @change=${(e) => { this._extentOnly = e.target.checked; this.load(); }}>
                    ${lizDict['catalog.table.extent']}
                </label>
                <button type="button" class="btn btn-sm catalog-table-refresh" title="${lizDict['catalog.table.refresh']}"
                    @click=${() => this.load()}><i class="icon-refresh"></i></button>
                <button type="button" class="btn btn-sm catalog-table-export" ?disabled=${!features.length}
                    @click=${() => this.exportCsv()}>CSV</button>
                <a class="btn btn-sm" href="${project.mapUrl}" target="_blank">${lizDict['catalog.table.edit']}</a>
            </div>
            ${this._loading ? html`<p class="catalog-loading">${lizDict['catalog.loading']}</p>` : ''}
            ${this._error ? html`<p class="catalog-error">${this._error}</p>` : ''}
            ${!this._loading && !this._error ? html`
                <p class="catalog-table-count">
                    ${features.length} / ${this._features.length}
                    ${this._truncated ? html` (${lizDict['catalog.table.truncated']})` : ''}
                </p>
                <div class="catalog-table-scroll">
                    <table class="table table-sm table-striped table-bordered">
                        <thead><tr><th></th>${columns.map(c => html`<th>${c}</th>`)}</tr></thead>
                        <tbody>
                            ${rows.map(feature => html`
                                <tr>
                                    <td>
                                        <button type="button" class="btn btn-sm catalog-table-zoom" title="${lizDict['catalog.table.zoom']}"
                                            ?disabled=${!feature.geometry}
                                            @click=${() => this.zoomToFeature(feature)}><i class="icon-zoom-in"></i></button>
                                    </td>
                                    ${columns.map(c => html`<td>${feature.properties?.[c] ?? ''}</td>`)}
                                </tr>`)}
                        </tbody>
                    </table>
                </div>
                ${pages > 1 ? html`
                    <div class="catalog-table-pages">
                        <button type="button" class="btn btn-sm" ?disabled=${page === 0}
                            @click=${() => { this._page = page - 1; this._render(); }}>‹</button>
                        <span>${page + 1} / ${pages}</span>
                        <button type="button" class="btn btn-sm" ?disabled=${page >= pages - 1}
                            @click=${() => { this._page = page + 1; this._render(); }}>›</button>
                    </div>` : ''}
            ` : ''}
        `, this);
    }
}
