/**
 * @module components/OverlayAnalysis.js
 * @name OverlayAnalysis
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';
import { html, render } from 'lit-html';
import GeoJSON from 'ol/format/GeoJSON.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { Circle as CircleGeometry } from 'ol/geom.js';
import { fromCircle } from 'ol/geom/Polygon.js';
import { transformExtent } from 'ol/proj.js';
import { Fill, Stroke, Style } from 'ol/style.js';

/** Number of attributes shown on a result card */
const CARD_FIELDS = 6;

/**
 * Overlay analysis: draw or import an area, choose the layers, list the
 * features intersected with their area and the share of the area they cover,
 * and analyse them with the AI assistant.
 * @class
 * @name OverlayAnalysis
 * @augments HTMLElement
 */
export default class OverlayAnalysis extends HTMLElement {
    constructor() {
        super();
        this._buffer = 0;
        this._selected = new Set();
        this._collapsed = new Set();
        this._loading = false;
        this._error = null;
        this._result = null;
        this._showArea = true;
        this._question = '';
        this._ai = { loading: false, data: null, error: null };
        this._table = { layer: null, sort: null, desc: false, filter: '' };
        this._geometries = 0;
    }

    connectedCallback() {
        this._tree = this._layerTree();
        // Every layer is chosen at first
        this._leaves(this._tree).forEach(item => this._selected.add(item.name));

        this._dockHandler = (e) => {
            if (e.id !== 'overlay') {
                return;
            }
            const digitizing = mainLizmap.digitizing;
            if (e.type === 'rightdockopened' || e.type === 'dockopened') {
                digitizing.context = 'overlay';
                digitizing.singlePartGeometry = false;
                digitizing.toggleVisibility(true);
                this._areaLayer.setVisible(this._showArea);
            } else {
                digitizing.toolSelected = 'deactivate';
                digitizing.toggleVisibility(false);
                this._areaLayer.setVisible(false);
            }
        };
        lizMap.events.on({
            rightdockopened: this._dockHandler,
            rightdockclosed: this._dockHandler,
            dockopened: this._dockHandler,
            dockclosed: this._dockHandler,
        });

        // The area analysed (with its buffer), on the map
        this._areaLayer = new VectorLayer({
            source: new VectorSource(),
            style: new Style({
                fill: new Fill({ color: 'rgba(255, 140, 0, 0.15)' }),
                stroke: new Stroke({ color: 'rgba(255, 140, 0, 1)', width: 2, lineDash: [6, 4] }),
            }),
        });
        mainLizmap.map.addToolLayer(this._areaLayer);

        this._drawnHandler = (event) => {
            this._geometries = this._drawnGeometries().length;
            // A geometry drawn: stop drawing, so that the map can be moved again
            if (event?.type === 'digitizing.featureDrawn' && mainLizmap.digitizing?.context === 'overlay') {
                setTimeout(() => { mainLizmap.digitizing.toolSelected = 'deactivate'; }, 0);
            }
            this._render();
        };
        this._eventTypes = ['digitizing.featureDrawn', 'digitizing.editionEnds', 'digitizing.erase', 'digitizing.erase.all'];
        mainEventDispatcher.addListener(this._drawnHandler, this._eventTypes);
        this._render();
    }

    disconnectedCallback() {
        lizMap.events.off({
            rightdockopened: this._dockHandler,
            rightdockclosed: this._dockHandler,
            dockopened: this._dockHandler,
            dockclosed: this._dockHandler,
        });
        mainEventDispatcher.removeListener(this._drawnHandler, this._eventTypes);
    }

    /**
     * The layers of the map having geometries, in the layer tree
     * @returns {{name: string, title: string, children: Array}} the root of the tree
     */
    _layerTree() {
        const walk = (item) => {
            if (item.type === 'group') {
                const children = item.children.map(walk).filter(Boolean);
                return children.length ? { name: item.name, title: item.layerConfig?.title || item.wmsTitle || item.name, children } : null;
            }
            const geometryType = item.layerConfig?.geometryType;
            if (!['point', 'line', 'polygon'].includes(geometryType)) {
                return null;
            }
            return { name: item.name, title: item.layerConfig?.title || item.wmsTitle || item.name, geometryType };
        };
        return walk(mainLizmap.state.layerTree) || { name: '', title: '', children: [] };
    }

    /**
     * @param {object} node - a node of the tree
     * @returns {Array<object>} its layers
     */
    _leaves(node) {
        return node.children ? node.children.flatMap(child => this._leaves(child)) : [node];
    }

    /**
     * @returns {Array<object>} the geometries drawn or imported, as GeoJSON in EPSG:4326
     */
    _drawnGeometries() {
        const format = new GeoJSON();
        const features = mainLizmap.digitizing?.context === 'overlay' ? (mainLizmap.digitizing.featureDrawn || []) : [];
        return features.map(feature => {
            let geometry = feature.getGeometry();
            if (geometry instanceof CircleGeometry) {
                geometry = fromCircle(geometry, 64);
            }
            return format.writeGeometryObject(geometry, {
                featureProjection: mainLizmap.projection,
                dataProjection: 'EPSG:4326',
                decimals: 7,
            });
        });
    }

    async _post(url, extra) {
        const params = new URLSearchParams({
            ...globalThis.lizUrls.params,
            geometries: JSON.stringify(this._drawnGeometries()),
            buffer: String(this._buffer || 0),
            layers: JSON.stringify(this._leaves(this._tree).map(item => item.name).filter(name => this._selected.has(name))),
            ...extra,
        });
        const response = await fetch(url, { method: 'POST', body: params });
        const text = await response.text();
        let data = {};
        try {
            data = JSON.parse(text);
        } catch {
            // Not a JSON answer, e.g. an error page of the server
            console.error('Overlay analysis: answer of the server', response.status, text.slice(0, 2000));
            data = { error: response.ok ? lizDict['overlay.error.answer'] : '' };
            if (response.ok) {
                const error = new Error(data.error);
                error.reason = 'error';
                throw error;
            }
        }
        if (!response.ok) {
            const error = new Error(data.error || response.statusText);
            error.reason = data.reason || ({ 504: 'timeout', 429: 'busy', 401: 'login' })[response.status] || 'error';
            throw error;
        }
        return data;
    }

    async _getJson(url, params) {
        const response = await fetch(url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params));
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || response.statusText);
            error.reason = data.reason || ({ 504: 'timeout', 429: 'busy', 401: 'login' })[response.status] || 'error';
            throw error;
        }
        return data;
    }

    /**
     * Intersect the area with the layers chosen
     * @returns {Promise<void>}
     */
    async run() {
        if (this._loading) {
            return;
        }
        this._error = null;
        if (this._drawnGeometries().length === 0) {
            this._error = lizDict['overlay.error.nogeometry'];
            this._render();
            return;
        }
        if (this._selected.size === 0) {
            this._error = lizDict['overlay.error.nolayer'];
            this._render();
            return;
        }
        this._loading = true;
        this._ai = { loading: false, data: null, error: null };
        this._render();
        try {
            const result = await this._post(this.getAttribute('url'));
            if (!result?.area || !Array.isArray(result.layers)) {
                console.error('Overlay analysis: unexpected answer', result);
                throw new Error(lizDict['overlay.error.answer']);
            }
            this._result = result;
            this._showResultArea();
        } catch (error) {
            console.error(error);
            this._error = error.message || lizDict['overlay.error.answer'];
            this._result = null;
        }
        this._loading = false;
        this._render();
    }

    /**
     * Ask the AI assistant about the area
     * @returns {Promise<void>}
     */
    async analyse() {
        if (this._ai.loading || !this._result) {
            return;
        }
        this._ai = { loading: true, data: null, error: null };
        this._render();
        try {
            let data = await this._post(this.getAttribute('ai-url'), { q: this._question.trim(), async: '1' });
            // Answered in the background: ask for the answer until it is ready
            const started = Date.now();
            while (data.job && this.getAttribute('ai-job-url')) {
                const job = data.job;
                await new Promise(resolve => setTimeout(resolve, 4000));
                this._ai.elapsed = Math.round((Date.now() - started) / 1000);
                this._render();
                data = await this._getJson(this.getAttribute('ai-job-url'), { id: job });
                if (data.state === 'running') {
                    if (Date.now() - started > 8 * 60 * 1000) {
                        const error = new Error('timeout');
                        error.reason = 'timeout';
                        throw error;
                    }
                    data = { job };
                }
            }
            this._ai.data = data;
        } catch (error) {
            this._ai.error = error;
        }
        this._ai.loading = false;
        this._render();
    }

    clear() {
        this._result = null;
        this._error = null;
        this._ai = { loading: false, data: null, error: null };
        this._areaLayer.getSource().clear();
        mainLizmap.digitizing.eraseAll?.();
        this._geometries = 0;
        this._render();
    }

    _showResultArea() {
        const source = this._areaLayer.getSource();
        source.clear();
        if (!this._result?.area?.geometry) {
            return;
        }
        const feature = new GeoJSON().readFeature(
            { type: 'Feature', geometry: this._result.area.geometry, properties: {} },
            { dataProjection: 'EPSG:4326', featureProjection: mainLizmap.projection },
        );
        source.addFeature(feature);
        this._areaLayer.setVisible(this._showArea);
    }

    /**
     * Zoom to an extent in EPSG:4326
     * @param {number[]} extent - the extent
     */
    zoomTo(extent) {
        if (!Array.isArray(extent)) {
            return;
        }
        let [xmin, ymin, xmax, ymax] = extent.map(Number);
        const margin = 0.0005;
        xmin -= margin; ymin -= margin; xmax += margin; ymax += margin;
        const mapExtent = transformExtent([xmin, ymin, xmax, ymax], 'EPSG:4326', mainLizmap.projection);
        mainLizmap.map.getView().fit(mapExtent, { maxZoom: 19, padding: [40, 40, 40, 40] });
    }

    /**
     * The results as a CSV file
     */
    exportCsv() {
        const rows = [['layer', 'field', 'value', 'feature', 'area_m2', 'percent', 'length_m']];
        for (const layer of this._result?.layers || []) {
            layer.features.forEach((feature, index) => {
                for (const field of layer.fields) {
                    rows.push([layer.title, field.alias, feature.properties[field.name] ?? '', index + 1,
                        feature.area ?? '', feature.percent ?? '', feature.length ?? '']);
                }
            });
        }
        const csv = rows.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(';')).join('\r\n');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
        link.download = 'overlay.csv';
        link.click();
        URL.revokeObjectURL(link.href);
    }

    _toggle(node, checked) {
        for (const leaf of this._leaves(node)) {
            if (checked) {
                this._selected.add(leaf.name);
            } else {
                this._selected.delete(leaf.name);
            }
        }
        this._render();
    }

    _treeTemplate(node) {
        if (!node.children) {
            return html`<li><label><input type="checkbox" .checked=${this._selected.has(node.name)}
                @change=${(e) => this._toggle(node, e.target.checked)}> ${node.title}</label></li>`;
        }
        const leaves = this._leaves(node);
        const count = leaves.filter(leaf => this._selected.has(leaf.name)).length;
        return html`<li><details open>
            <summary><label><input type="checkbox" .checked=${count === leaves.length}
                .indeterminate=${count > 0 && count < leaves.length}
                @change=${(e) => this._toggle(node, e.target.checked)}> ${node.title}</label></summary>
            <ul>${node.children.map(child => this._treeTemplate(child))}</ul>
        </details></li>`;
    }

    _measures(feature) {
        if (feature.area !== null && feature.area !== undefined) {
            return html`<div><b>${lizDict['overlay.area']}:</b> ${feature.area.toLocaleString()}
                ${feature.percent !== null ? html` | <b>%:</b> ${feature.percent.toLocaleString()}` : ''}</div>`;
        }
        if (feature.length !== null && feature.length !== undefined) {
            return html`<div><b>${lizDict['overlay.length']}:</b> ${feature.length.toLocaleString()}</div>`;
        }
        return '';
    }

    _layerTemplate(layer) {
        const open = !this._collapsed.has(layer.name);
        const status = layer.status !== 'ok'
            ? html`<p class="overlay-note">${lizDict['overlay.status.' + layer.status] || lizDict['overlay.status.error']}</p>`
            : layer.features.length === 0 ? html`<p class="overlay-note">${lizDict['overlay.none']}</p>` : '';
        return html`<details class="overlay-layer" ?open=${open}
            @toggle=${(e) => { e.target.open ? this._collapsed.delete(layer.name) : this._collapsed.add(layer.name); }}>
            <summary>${layer.title} <span class="badge text-bg-secondary">${layer.features.length}${layer.truncated ? '+' : ''}</span></summary>
            ${status}
            ${layer.features.map(feature => html`<div class="overlay-feature">
                ${layer.fields.slice(0, CARD_FIELDS).map(field => html`<div><b>${field.alias}:</b> ${feature.properties[field.name] ?? ''}</div>`)}
                ${this._measures(feature)}
                ${feature.extent ? html`<button type="button" class="btn btn-sm overlay-zoom" title="${lizDict['overlay.zoom']}"
                    @click=${() => this.zoomTo(feature.extent)}><i class="icon-zoom-in"></i></button>` : ''}
            </div>`)}
        </details>`;
    }

    _aiTemplate() {
        if (!this.hasAttribute('ai-url')) {
            return '';
        }
        const ai = this._ai;
        const data = ai.data;
        return html`<div class="overlay-ai catalog-ai-analysis">
            <h4>${lizDict['overlay.ai.title']}</h4>
            <form @submit=${(e) => { e.preventDefault(); this.analyse(); }}>
                <textarea class="form-control form-control-sm" rows="2" maxlength="500"
                    placeholder="${lizDict['overlay.ai.question']}" .value=${this._question}
                    @input=${(e) => { this._question = e.target.value; }}></textarea>
                <button type="submit" class="btn btn-sm btn-primary mt-1" ?disabled=${ai.loading}>${lizDict['overlay.ai.analyse']}</button>
            </form>
            ${ai.loading ? html`<p class="catalog-loading">${lizDict['overlay.ai.analysing']}
                ${ai.elapsed ? html`(${ai.elapsed} s)` : ''}</p>` : ''}
            ${ai.error ? html`<div class="catalog-error"><p>${lizDict['catalog.ai.error.' + ai.error.reason] || lizDict['catalog.ai.error']}</p>
                ${ai.error.message ? html`<details><summary>${lizDict['catalog.ai.error.details']}</summary><code>${ai.error.message}</code></details>` : ''}</div>` : ''}
            ${data ? html`<div class="catalog-ai-answer">
                <p>${data.answer}</p>
                ${data.highlights?.length ? html`<h5>${lizDict['catalog.ai.highlights']}</h5>
                    <ul>${data.highlights.map(item => html`<li>${typeof item === 'string' ? item : item.text}</li>`)}</ul>` : ''}
                ${data.suggestions?.length ? html`<h5>${lizDict['catalog.ai.suggestions']}</h5>
                    <ul>${data.suggestions.map(item => html`<li>${item}</li>`)}</ul>` : ''}
                ${data.documents?.length ? html`<p class="catalog-ai-source">${lizDict['catalog.ai.documents']}
                    ${data.documents.map(doc => doc.collection + ' — ' + (/^\d/.test(doc.label) ? 'Art. ' : '') + doc.label).join('; ')}</p>` : ''}
            </div>` : ''}
        </div>`;
    }

    _resultTemplate() {
        const result = this._result;
        if (!result) {
            return '';
        }
        return html`<div class="overlay-results">
            <h4>${lizDict['overlay.results']}</h4>
            <p>${lizDict['overlay.area.total']}: <b>${result.area.area.toLocaleString()} m²</b>
                ${result.buffer > 0 ? html`(${lizDict['overlay.buffer']}: ${result.buffer} m)` : ''}</p>
            <div class="overlay-actions">
                <label><input type="checkbox" .checked=${this._showArea}
                    @change=${(e) => { this._showArea = e.target.checked; this._areaLayer.setVisible(this._showArea); }}>
                    ${lizDict['overlay.showarea']}</label>
                <button type="button" class="btn btn-sm" @click=${() => this.zoomTo(result.area.extent)}><i class="icon-zoom-in"></i></button>
            </div>
            <div class="overlay-actions">
                <button type="button" class="btn btn-sm" @click=${() => this.openTables()}>${lizDict['overlay.tables']}</button>
                <button type="button" class="btn btn-sm" @click=${() => { this._collapsed.clear(); this._render(); }}>${lizDict['overlay.expand']}</button>
                <button type="button" class="btn btn-sm" @click=${() => { result.layers.forEach(l => this._collapsed.add(l.name)); this._render(); }}>${lizDict['overlay.collapse']}</button>
                <button type="button" class="btn btn-sm" @click=${() => this.exportCsv()}>${lizDict['overlay.export']}</button>
            </div>
            ${this._aiTemplate()}
            ${result.layers.map(layer => this._layerTemplate(layer))}
        </div>`;
    }

    /**
     * The tables of the features intersected, in a modal window, one tab by layer
     */
    openTables() {
        const layers = (this._result?.layers || []).filter(layer => layer.features.length);
        if (!layers.length) {
            return;
        }
        if (!layers.some(layer => layer.name === this._table.layer)) {
            this._table = { layer: layers[0].name, sort: null, desc: false, filter: '' };
        }
        let dialog = document.getElementById('overlay-tables');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'overlay-tables';
            dialog.className = 'overlay-tables';
            document.body.append(dialog);
        }
        this._dialog = dialog;
        this._renderTables();
        dialog.showModal();
    }

    _renderTables() {
        const layers = (this._result?.layers || []).filter(layer => layer.features.length);
        const table = this._table;
        const layer = layers.find(item => item.name === table.layer);
        const columns = layer ? [
            ...layer.fields.map(field => ({ key: field.name, label: field.alias, value: f => f.properties[field.name] })),
            ...(layer.features.some(f => f.area !== null) ? [
                { key: '__area', label: lizDict['overlay.area'], value: f => f.area },
                { key: '__percent', label: '%', value: f => f.percent },
            ] : []),
            ...(layer.features.some(f => f.length !== null) ? [{ key: '__length', label: lizDict['overlay.length'], value: f => f.length }] : []),
        ] : [];
        const words = table.filter.toLowerCase().split(/\s+/).filter(Boolean);
        let rows = layer ? layer.features.filter(f => words.every(word =>
            columns.some(column => String(column.value(f) ?? '').toLowerCase().includes(word)))) : [];
        const sortColumn = columns.find(column => column.key === table.sort);
        if (sortColumn) {
            rows = [...rows].sort((a, b) => {
                const x = sortColumn.value(a);
                const y = sortColumn.value(b);
                const order = typeof x === 'number' && typeof y === 'number'
                    ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
                return table.desc ? -order : order;
            });
        }
        const sortBy = (key) => {
            table.desc = table.sort === key ? !table.desc : false;
            table.sort = key;
            this._renderTables();
        };
        render(html`
            <div class="overlay-tables-header">
                <h3>${lizDict['overlay.title']}</h3>
                <button type="button" class="btn-close" aria-label="${lizDict['overlay.close']}" @click=${() => this._dialog.close()}></button>
            </div>
            <ul class="nav nav-tabs">
                ${layers.map(item => html`<li class="nav-item"><button type="button"
                    class="nav-link ${item.name === table.layer ? 'active' : ''}"
                    @click=${() => { this._table = { layer: item.name, sort: null, desc: false, filter: '' }; this._renderTables(); }}>
                    ${item.title} (${item.features.length})</button></li>`)}
            </ul>
            <input type="search" class="form-control form-control-sm my-2" placeholder="${lizDict['overlay.filter']}"
                .value=${table.filter} @input=${(e) => { table.filter = e.target.value; this._renderTables(); }}>
            <div class="overlay-table-container">
                <table class="table table-sm table-striped">
                    <thead><tr>${columns.map(column => html`<th @click=${() => sortBy(column.key)}>${column.label}
                        ${table.sort === column.key ? (table.desc ? '▼' : '▲') : '↕'}</th>`)}<th></th></tr></thead>
                    <tbody>${rows.map(f => html`<tr>${columns.map(column => html`<td>${column.value(f) ?? ''}</td>`)}
                        <td>${f.extent ? html`<button type="button" class="btn btn-sm" title="${lizDict['overlay.zoom']}"
                            @click=${() => { this._dialog.close(); this.zoomTo(f.extent); }}><i class="icon-zoom-in"></i></button>` : ''}</td></tr>`)}</tbody>
                </table>
            </div>
            <div class="overlay-tables-footer">
                <button type="button" class="btn btn-primary" @click=${() => this._dialog.close()}>${lizDict['overlay.close']}</button>
            </div>`, this._dialog);
    }

    _render() {
        try {
            this._renderPanel();
        } catch (error) {
            // Never a blank panel: show the error
            console.error(error);
            this._result = null;
            this._error = (lizDict['overlay.error.answer'] || 'Error') + ' (' + error.message + ')';
            this._renderPanel();
        }
    }

    _renderPanel() {
        const leaves = this._leaves(this._tree);
        const count = leaves.filter(leaf => this._selected.has(leaf.name)).length;
        render(html`
        <div class="overlay">
            <p class="overlay-help">${lizDict['overlay.help']}</p>
            <h4>${lizDict['overlay.draw']}</h4>
            <lizmap-digitizing context="overlay" selected-tool="polygon"
                available-tools="point,line,polygon,box,circle,freehand" import-export></lizmap-digitizing>
            <p class="overlay-note">${lizDict['overlay.geometries'].replace('%s', this._geometries)}</p>
            <label class="overlay-buffer">${lizDict['overlay.buffer']} (m)
                <input type="number" min="0" max="5000" step="1" class="form-control form-control-sm" .value=${String(this._buffer)}
                    @input=${(e) => { this._buffer = Math.max(0, Math.min(5000, Number(e.target.value) || 0)); }}>
            </label>
            <details class="overlay-themes" open>
                <summary>${lizDict['overlay.themes']}</summary>
                <ul class="overlay-tree">${this._tree.children.map(child => this._treeTemplate(child))}</ul>
                <p class="overlay-note">${lizDict['overlay.themes.count'].replace('%s', count).replace('%t', leaves.length)}</p>
            </details>
            <div class="overlay-buttons">
                <button type="button" class="btn" @click=${() => this.clear()}>${lizDict['overlay.clear']}</button>
                <button type="button" class="btn btn-primary" ?disabled=${this._loading} @click=${() => this.run()}>${lizDict['overlay.run']}</button>
            </div>
            ${this._loading ? html`<p class="catalog-loading">${lizDict['overlay.running']}</p>` : ''}
            ${this._error ? html`<div class="catalog-error"><p>${this._error}</p></div>` : ''}
            ${this._resultTemplate()}
        </div>`, this);
    }
}
