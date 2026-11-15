/**
 * @module components/MapViews.js
 * @name MapViews
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

import { mainLizmap } from '../modules/Globals.js';
import { html, render } from 'lit-html';

/**
 * Map views saved by the connected user, in the database: the layer tree
 * order and the layers added from the data catalog. A saved view can be
 * loaded again on the same map.
 * @class
 * @name MapViews
 * @augments HTMLElement
 */
export default class MapViews extends HTMLElement {
    constructor() {
        super();
        this._views = [];
        this._selected = '';
        this._busy = false;
    }

    connectedCallback() {
        this._render();
        this.refresh();
    }

    /**
     * URLs of the map views actions, only given to connected users
     * @type {object|undefined}
     */
    get urls() {
        return globalThis.lizUrls?.mapViews;
    }

    _params(extra = {}) {
        const params = globalThis.lizUrls.params;
        return new URLSearchParams({ repository: params.repository, project: params.project, ...extra });
    }

    async _request(url, extra = {}, post = false) {
        const response = post
            ? await fetch(url, { method: 'POST', body: this._params(extra) })
            : await fetch(url + '?' + this._params(extra).toString());
        if (!response.ok) {
            throw new Error(response.statusText);
        }
        return response.json();
    }

    async _run(action) {
        this._busy = true;
        this._render();
        try {
            await action();
        } catch (error) {
            console.error(error);
            lizMap.addMessage(lizDict['mapviews.error'], 'danger', true);
        }
        this._busy = false;
        this._render();
    }

    /**
     * Reload the list of saved views
     * @returns {Promise<void>}
     */
    refresh() {
        if (!this.urls) {
            return Promise.resolve();
        }
        return this._run(async () => {
            this._views = await this._request(this.urls.list);
        });
    }

    /**
     * Save the current layer order and catalog layers
     * @param {string} name - the view name, an existing view of this name is replaced
     * @returns {Promise<void>}
     */
    save(name) {
        const treeview = document.querySelector('lizmap-treeview');
        const catalog = document.querySelector('lizmap-catalog');
        const config = {
            order: treeview?.arrangement?.order || {},
            catalog: catalog?.addedLayers || [],
        };
        return this._run(async () => {
            const view = await this._request(this.urls.save, { name, config: JSON.stringify(config) }, true);
            this._views = await this._request(this.urls.list);
            this._selected = String(view.id);
            lizMap.addMessage(lizDict['mapviews.saved'], 'info', true);
        });
    }

    /**
     * Load a saved view
     * @param {string} id - the view id
     * @returns {Promise<void>}
     */
    load(id) {
        return this._run(async () => {
            const view = await this._request(this.urls.get, { id });
            const treeview = document.querySelector('lizmap-treeview');
            treeview?.arrangement?.setOrder(view.config?.order, mainLizmap.state.layerTree, mainLizmap.map);
            await document.querySelector('lizmap-catalog')?.restore(view.config?.catalog || []);
            treeview?.refresh();
        });
    }

    /**
     * Delete a saved view
     * @param {string} id - the view id
     * @returns {Promise<void>}
     */
    delete(id) {
        return this._run(async () => {
            await this._request(this.urls.delete, { id }, true);
            this._views = await this._request(this.urls.list);
            this._selected = '';
        });
    }

    _render() {
        if (!this.urls) {
            render(html`<p class="mapviews-login">${lizDict['mapviews.login']}</p>`, this);
            return;
        }
        render(html`
            <div class="mapviews-load">
                <select class="mapviews-list form-select form-select-sm" ?disabled=${this._busy}
                    @change=${(e) => { this._selected = e.target.value; this._render(); }}>
                    <option value="" ?selected=${this._selected === ''}>${lizDict['mapviews.choose']}</option>
                    ${this._views.map(view => html`
                        <option value="${view.id}" ?selected=${this._selected === String(view.id)}>${view.name}</option>`)}
                </select>
                <button type="button" class="btn btn-sm mapviews-apply" ?disabled=${this._busy || !this._selected}
                    @click=${() => this.load(this._selected)}>${lizDict['mapviews.load']}</button>
                <button type="button" class="btn btn-sm mapviews-delete" ?disabled=${this._busy || !this._selected}
                    title="${lizDict['mapviews.delete']}"
                    @click=${() => this.delete(this._selected)}><i class="icon-trash"></i></button>
            </div>
            <form class="mapviews-save" @submit=${(e) => {
                e.preventDefault();
                const input = e.target.querySelector('input');
                if (input.value.trim()) {
                    this.save(input.value.trim());
                }
            }}>
                <input type="text" class="form-control form-control-sm mapviews-name" maxlength="100" required
                    placeholder="${lizDict['mapviews.name']}"
                    .value=${this._views.find(v => String(v.id) === this._selected)?.name || ''}>
                <button type="submit" class="btn btn-sm btn-primary mapviews-submit"
                    ?disabled=${this._busy}>${lizDict['mapviews.save']}</button>
            </form>
        `, this);
    }
}
