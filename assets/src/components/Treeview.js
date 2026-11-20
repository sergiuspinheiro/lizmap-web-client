/**
 * @module components/Treeview.js
 * @name Treeview
 * @copyright 2023 3Liz
 * @author BOISTEAULT Nicolas
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';
import { Utils } from '../modules/Utils.js';
import { MapLayerLoadStatus } from '../modules/state/MapLayer.js';
import { MEDIA_REGEX } from '../utils/Constants.js';
import TreeArrangement from '../modules/TreeArrangement.js';

import { html, render } from 'lit-html';

/**
 * @class
 * @name Treeview
 * @augments HTMLElement
 */
export default class Treeview extends HTMLElement {
    constructor() {
        super();
        this._itemNameSelected;
        this._clickTimestamp;
        // Item being dragged in arrange mode: {parent, name}
        this._dragged = null;
        // OpenLayers layers of the catalog layers whose settings are displayed
        // OpenLayers layers of the catalog layers whose legend is expanded
        this._catalogLegendOpen = new WeakSet();
    }

    connectedCallback() {
        const params = globalThis.lizUrls?.params || {};
        this._arrangement = new TreeArrangement(`lizmap-tree-arrangement-${params.repository}-${params.project}`);
        this._arrangeButton = document.getElementById('layers-arrange');
        this._arrangeHandler = () => {
            this._arrangement.active = !this._arrangement.active;
            this._arrangeButton?.classList.toggle('active', this._arrangement.active);
            this._onChange();
        };
        this._arrangeButton?.addEventListener('click', this._arrangeHandler);
        this._catalogHandler = () => this._onChange();
        document.addEventListener('lizmapcatalogchanged', this._catalogHandler);

        this._onChange = () => {
            if (this._freeze) return;
            render(this._rootTemplate(mainLizmap.state.layerTree), this);
        };

        this._olLayerTemplate = (olLayer, extGroup) =>
            html`
        <li data-testid="ol-${olLayer.name}"
            draggable="${this._arrangement.active ? 'true' : 'false'}"
            @dragstart=${(e) => this._dragStart(e, olLayer, extGroup)}
            @dragover=${(e) => this._dragOver(e, olLayer, extGroup)}
            @drop=${(e) => this._drop(e, olLayer, extGroup)}
            @dragend=${() => this._dragEnd()}>
            ${this._catalogSymbols(olLayer).length
                ? html`<div class="expandable ${this._catalogLegendOpen.has(this._olOf(olLayer)) ? 'expanded' : ''}"
                    @click=${() => this._toggleCatalogLegend(olLayer)}></div>`
                : ''}
            <div class="${olLayer.checked ? 'checked' : ''} ${olLayer.type} ${this._catalogInfoShown(olLayer) ? 'selected' : ''}">
                <div class="loading ${olLayer.loadStatus === MapLayerLoadStatus.Loading ? 'spinner' : ''}"></div>
                <input type="checkbox" id="node-ol-${olLayer.name}" .checked=${olLayer.checked} @click=${() => olLayer.checked = !olLayer.checked} >
                <div class="node ${olLayer.isFiltered ? 'filtered' : ''}">
                    <img class="legend" src="${olLayer.icon}">
                    <label for="node-ol-${olLayer.name}">${olLayer.wmsTitle}</label>
                    <div class="layer-actions">
                        ${this._olOf(olLayer)?.get('lizmapCatalog')
                            ? html`<i class="icon-info-sign" title="${lizDict['layer.metadata.title']}"
                                @click=${() => this._showCatalogInfo(olLayer)}></i>`
                            : ''}
                    </div>
                </div>
            </div>
            ${this._catalogSymbols(olLayer).length
                ? html`
                    <ul class="symbols">
                        ${this._catalogSymbols(olLayer).map(symbol => html`
                            <li class="symbol">
                                <label class="symbol-title">
                                    ${symbol.toggle
                                        ? html`<input type="checkbox" .checked=${symbol.checked} @click=${() => symbol.toggle()}>`
                                        : ''}
                                    <img class="legend" src="${symbol.icon}">${symbol.title}</label>
                            </li>`)}
                    </ul>`
                : ''}
        </li>`

        this._extGroupTemplate = (extGroup, parent) =>
            html`
        <li data-testid="ext-${extGroup.name}"
            draggable="${this._arrangement.active ? 'true' : 'false'}"
            @dragstart=${(e) => this._dragStart(e, extGroup, parent)}
            @dragover=${(e) => this._dragOver(e, extGroup, parent)}
            @drop=${(e) => this._drop(e, extGroup, parent)}
            @dragend=${() => this._dragEnd()}>
            <div class="expandable ${extGroup.expanded ? 'expanded' : ''}" @click=${() => extGroup.expanded = !extGroup.expanded}></div>
            <div class="${extGroup.checked ? 'checked' : ''} ${extGroup.type} group">
                <div class="node">
                    <label for="node-ext-${extGroup.name}">${extGroup.wmsTitle}</label>
                    <div class="layer-actions">
                    </div>
                </div>
            </div>
            <ul>
                ${this._arrangement.sortChildren(this._parentKey(extGroup), extGroup.children).map(item => html`
                    ${this._olLayerTemplate(item, extGroup)}
                `)}
            </ul>
        </li>`

        this._symbolImageTemplate = symbol =>
            html`
        <label class="symbol-title">
            <img class="legend" alt="${symbol.title}" src="${this._createGetMediaLink(symbol.url)}">
        </label>`

        this._symbolIconTemplate = symbol =>
            html`
        <label class="symbol-title">
            ${symbol.ruleKey
                ? html`<input type="checkbox" .checked=${symbol.checked} @click=${() => symbol.checked = !symbol.checked}>`
                : ''
            }
            <img class="legend" src="${symbol.icon}">
            ${symbol.title}
        </label>
        ${(symbol.childrenCount)
            ? html`
                    <ul class="symbols">
                        ${symbol.children.map(s => this._symbolTemplate(s))}
                    </ul>`
                : ''
        }
        `

        this._symbolTemplate = symbol =>
            html`
        <li class="symbol ${symbol.type}${this._isInScale(symbol) ? '' : ' not-in-scale'}${symbol.ruleKey && !symbol.checked ? ' not-visible' : ''}">
            ${(symbol.childrenCount)
                ? html`
                        <div class="expandable ${symbol.expanded ? 'expanded' : ''}" @click=${() => symbol.expanded = !symbol.expanded}></div>`
                    : ''
            }
            ${symbol.type === 'image' ? html`${this._symbolImageTemplate(symbol)}` : ''}
            ${symbol.type !== 'image' ? html`${this._symbolIconTemplate(symbol)}` : ''}
        </li>`

        this._layerTemplate = (layer, parent) =>
            html`
        <li data-testid="${layer.name}" class="${this._isVisible(layer) ? '' : 'not-visible'}"
            draggable="${this._arrangement.active ? 'true' : 'false'}"
            @dragstart=${(e) => this._dragStart(e, layer, parent)}
            @dragover=${(e) => this._dragOver(e, layer, parent)}
            @drop=${(e) => this._drop(e, layer, parent)}
            @dragend=${() => this._dragEnd()}>
            ${layer.symbologyChildrenCount && layer.layerConfig.legendImageOption !== "disabled"
                ? html`<div class="expandable ${layer.expanded ? 'expanded' : ''}" @click=${() => layer.expanded = !layer.expanded}></div>`
                : ''
            }
            <div class="${layer.checked ? 'checked' : ''} ${layer.type} ${layer.name === this._itemNameSelected ? 'selected' : ''}">
                <div class="loading ${layer.loadStatus === MapLayerLoadStatus.Loading ? 'spinner' : ''}"></div>
                <input type="checkbox"
                    class="${parent.mutuallyExclusive ? 'rounded-checkbox' : ''}"
                    id="node-${layer.name}"
                    .checked=${layer.checked}
                    @click=${(evt) => this._clickItem(evt,layer)}
                    @dblclick=${() =>this._dblclickItem(layer)}
                    >
                <div class="node ${layer.isFiltered ? 'filtered' : ''}">
                    <img class="legend" src="${layer.icon}">
                    <label for="node-${layer.name}" >${layer.layerConfig.title}</label>
                    <div class="layer-actions">
                        <a href="${this._createDocLink(layer.name)}" target="_blank" title="${lizDict['tree.button.link']}">
                            <i class="icon-share"></i>
                        </a>
                        ${layer.layerConfig.cached
                            ? html`
                                <a href="${this._createRemoveCacheLink(layer.name)}" target="_blank">
                                    <i class="icon-remove-sign" title="${lizDict['tree.button.removeCache']}" @click=${event => this._removeCache(event)}></i>
                                </a>`
                            : ''
                        }
                        <i class="icon-info-sign" @click=${() => this.itemNameSelected = layer.name}></i>
                    </div>
                </div>
            </div>
            ${(layer.symbologyChildrenCount && layer.layerConfig.legendImageOption !== "disabled")
                ? html`
                    <ul class="symbols">
                        ${layer.symbologyChildren.map(symbol => this._symbolTemplate(symbol))}
                    </ul>`
                : ''
            }
        </li>`

        this._groupTemplate = (group, parent) =>
            html`
        <li data-testid="${group.name}" class="${this._isVisible(group) ? '' : 'not-visible'}"
            draggable="${this._arrangement.active ? 'true' : 'false'}"
            @dragstart=${(e) => this._dragStart(e, group, parent)}
            @dragover=${(e) => this._dragOver(e, group, parent)}
            @drop=${(e) => this._drop(e, group, parent)}
            @dragend=${() => this._dragEnd()}>
            <div class="expandable ${group.expanded ? 'expanded' : ''}" @click=${() => group.expanded = !group.expanded}></div>
            <div class="${group.checked ? 'checked' : ''} ${group.type} ${group.name === this._itemNameSelected ? 'selected' : ''}">
                ${mainLizmap.initialConfig.options.hideGroupCheckbox
                    ? ''
                    : html`<input type="checkbox" class="${parent.mutuallyExclusive ? 'rounded-checkbox' : ''}"
                      id="node-${group.name}"
                      .checked=${group.checked}
                      @click=${(evt) => this._clickItem(evt, group)}
                      @dblclick=${() => this._dblclickItem(group)} >`
                }
                <div class="node ${group.isFiltered ? 'filtered' : ''}">
                    ${mainLizmap.initialConfig.options.hideGroupCheckbox
                        ? html`<label for="node-${group.name}" >${group.layerConfig.title}</label>`
                        : html`<label
                          for="node-${group.name}"
                          @dblclick=${() => this._dblclickItem(group)} } >${group.layerConfig.title}</label>`
                    }
                    <div class="layer-actions">
                        <a href="${this._createDocLink(group.name)}" target="_blank" title="${lizDict['tree.button.link']}">
                            <i class="icon-share"></i>
                        </a>
                        ${group.layerConfig.cached
                            ? html`
                                <a href="${this._createRemoveCacheLink(group.name)}" target="_blank">
                                    <i class="icon-remove-sign" title="${lizDict['tree.button.removeCache']}" @click=${event => this._removeCache(event)}></i>
                                </a>`
                            : ''
                        }
                        <i class="icon-info-sign" @click=${() => this.itemNameSelected = group.name}></i>
                    </div>
                </div>
            </div>
            <ul>
                ${this._arrangement.sortChildren(group.name, group.children).map(item => html`
                    ${item.type === 'group' ? html`${this._groupTemplate(item, group)}` : ''}
                    ${item.type === 'layer' ? html`${this._layerTemplate(item, group)}` : ''}
                `)}
            </ul>
        </li>`

        this._rootTemplate = layerTreeRoot =>
            html`
        ${this._arrangement.active ? this._arrangeBarTemplate(layerTreeRoot) : ''}
        <ul class="${this._arrangement.active ? 'arranging' : ''}">
            ${this._arrangement.sortChildren('', layerTreeRoot.children).map(item => html`
                ${item.type === 'group' ? html`${this._groupTemplate(item, layerTreeRoot)}` : ''}
                ${item.type === 'layer' ? html`${this._layerTemplate(item, layerTreeRoot)}` : ''}
                ${item.type === 'ext-group' && item.childrenCount ? html`${this._extGroupTemplate(item, layerTreeRoot)}` : ''}
            `)}
        </ul>`;

        render(this._rootTemplate(mainLizmap.state.layerTree), this);
        if (this._arrangement.isCustomized) {
            this._arrangement.applyDrawingOrder(mainLizmap.state.layerTree, mainLizmap.map);
        }

        mainLizmap.state.layerTree.addListener(
            this._onChange,
            [
                'layer.load.status.changed', 'layer.visibility.changed', 'group.visibility.changed', 'layer.style.changed',
                'layer.symbology.changed', 'layer.filter.changed', 'layer.expanded.changed', 'group.expanded.changed',
                'layer.symbol.expanded.changed', 'ol-layer.added', 'ext-group.expanded.changed', 'ol-layer.removed', 'ext-group.removed',
                'layer.visibility.changed', 'ol-layer.visibility.changed', 'ext-group.visibility.changed',
                'ol-layer.wmsTitle.changed', 'ol-layer.icon.changed', 'ext-group.wmsTitle.changed',
            ]
        );

        // Layers added from the data catalog follow the user order
        // (after the tree items of the new layers are created)
        mainLizmap.state.layerTree.addListener(() => queueMicrotask(() => {
            if (this._arrangement.isCustomized) {
                this._arrangement.applyDrawingOrder(mainLizmap.state.layerTree, mainLizmap.map);
            }
        }), ['ol-layer.added', 'ext-group.added']);

        mainEventDispatcher.addListener(
            this._onChange, ['resolution.changed']
        );

        // layertree has been created, fire corresponding event
        mainLizmap.lizmap3.events.triggerEvent('treecreated');
    }

    disconnectedCallback() {
        this._arrangeButton?.removeEventListener('click', this._arrangeHandler);
        document.removeEventListener('lizmapcatalogchanged', this._catalogHandler);
        mainLizmap.state.layerTree.removeListener(
            this._onChange,
            [
                'ext-group.expanded.changed',
                'ext-group.visibility.changed',
                'group.expanded.changed',
                'group.visibility.changed',
                'layer.expanded.changed',
                'layer.filter.changed',
                'layer.load.status.changed',
                'layer.style.changed',
                'layer.symbol.expanded.changed',
                'layer.symbology.changed',
                'layer.visibility.changed',
                'ol-layer.visibility.changed',
            ]
        );

        mainEventDispatcher.removeListener(
            this._onChange, ['resolution.changed']
        );
    }

    /**
     * The user arrangement of the tree
     * @type {TreeArrangement}
     */
    get arrangement() {
        return this._arrangement;
    }

    /**
     * Render the tree again, for instance after loading a saved map view
     */
    refresh() {
        this._onChange();
    }

    /**
     * Key of a parent group in the arrangement: the root has no name
     * @param {object} parent - the parent group state
     * @returns {string} the key
     */
    _parentKey(parent) {
        if (parent.type === 'ext-group') {
            return TreeArrangement.externalKey(parent.name);
        }
        return parent === mainLizmap.state.layerTree ? '' : parent.name;
    }

    /**
     * OpenLayers layer of an external layer tree item
     * @param {object} item - the layer tree item or the map layer state
     * @returns {object|undefined} the OpenLayers layer
     */
    _olOf(item) {
        return item.mapItemState?.olLayer ?? item.olLayer;
    }

    /**
     * Legend symbols of a catalog layer, read by the catalog
     * @param {object} item - the layer tree item
     * @returns {Array<{title: string, icon: string}>} the symbols
     */
    _catalogSymbols(item) {
        return this._olOf(item)?.get('lizmapCatalogSymbols') || [];
    }

    _toggleCatalogLegend(item) {
        const olLayer = this._olOf(item);
        if (this._catalogLegendOpen.has(olLayer)) {
            this._catalogLegendOpen.delete(olLayer);
        } else {
            this._catalogLegendOpen.add(olLayer);
        }
        this._onChange();
    }

    /**
     * Show the information of a layer added by the catalog in the sub-dock
     * @param {object} olLayerState - the layer state
     */
    _showCatalogInfo(olLayerState) {
        const catalog = this._olOf(olLayerState)?.get('lizmapCatalog');
        if (catalog) {
            document.querySelector('lizmap-catalog')?.showLayerInfo(catalog.key, catalog.name);
        }
    }

    /**
     * Is the information of a layer added by the catalog displayed
     * @param {object} olLayerState - the layer state
     * @returns {boolean} true if displayed
     */
    _catalogInfoShown(olLayerState) {
        const catalog = this._olOf(olLayerState)?.get('lizmapCatalog');
        return Boolean(catalog && document.querySelector('lizmap-catalog')?.isInfoShown(catalog.key, catalog.name));
    }

    _dragStart(e, item, parent) {
        if (!this._arrangement.active || this._dragged) {
            return;
        }
        // Nested items: only the innermost one is dragged
        e.stopPropagation();
        this._dragged = { parent, name: item.name };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.name);
        e.currentTarget.classList.add('dragging');
    }

    _dragOver(e, item, parent) {
        if (!this._dragged || this._dragged.parent !== parent) {
            return;
        }
        // Items can only be moved inside their group
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const li = e.currentTarget;
        const rect = li.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        this.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
        if (item.name !== this._dragged.name) {
            li.classList.add(after ? 'drop-after' : 'drop-before');
        }
    }

    _drop(e, item, parent) {
        if (!this._dragged || this._dragged.parent !== parent) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        const parentKey = this._parentKey(parent);
        const siblings = this._arrangement.sortChildren(parentKey, parent.children).map(child => child.name);
        if (this._arrangement.move(parentKey, siblings, this._dragged.name, item.name, after)) {
            this._arrangement.applyDrawingOrder(mainLizmap.state.layerTree, mainLizmap.map);
        }
        this._dragEnd();
    }

    _dragEnd() {
        this._dragged = null;
        this.querySelectorAll('.dragging, .drop-before, .drop-after')
            .forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after'));
        this._onChange();
    }

    _arrangeBarTemplate(layerTreeRoot) {
        return html`
        <div class="tree-arrange-bar">
            <span>${lizDict['tree.arrange.help']}</span>
            ${this._arrangement.isCustomized
                ? html`<button type="button" class="btn btn-sm tree-arrange-reset" @click=${() => {
                    this._arrangement.reset(layerTreeRoot, mainLizmap.map);
                    this._onChange();
                }}>${lizDict['tree.arrange.reset']}</button>`
                : ''}
            <lizmap-mapviews></lizmap-mapviews>
        </div>`;
    }

    get itemNameSelected() {
        return this._itemNameSelected;
    }

    set itemNameSelected(itemName) {
        const oldItemnameSelected = this._itemNameSelected;
        if (itemName === undefined && this._itemNameSelected !== undefined) {
            itemName = ''+this._itemNameSelected;
            this._itemNameSelected = undefined;
        } else if (this._itemNameSelected === itemName) {
            this._itemNameSelected = undefined;
        } else {
            this._itemNameSelected = itemName;
        }

        if (itemName !== undefined) {
            lizMap.events.triggerEvent("lizmapswitcheritemselected",
                { 'name': itemName, 'selected': this._itemNameSelected !== undefined }
            );
        }

        if (oldItemnameSelected !== this._itemNameSelected) {
            this._onChange();
        }
    }

    _isVisible(item) {
        if (item.type === 'group') {
            return item.visibility;
        }
        const metersPerUnit = mainLizmap.map.getView().getProjection().getMetersPerUnit();
        const scale = Utils.getScaleFromResolution(mainLizmap.map.getView().getResolution(), metersPerUnit);
        const visibility = item.isVisible(scale);
        return visibility;
    }

    _isInScale(symbol) {
        if (symbol.minScaleDenominator !== undefined && symbol.maxScaleDenominator !== undefined
            && symbol.maxScaleDenominator > symbol.minScaleDenominator){
            const metersPerUnit = mainLizmap.map.getView().getProjection().getMetersPerUnit();
            const scale = Utils.getScaleFromResolution(mainLizmap.map.getView().getResolution(), metersPerUnit);
            return symbol.minScaleDenominator < scale
            && scale < symbol.maxScaleDenominator;
        }
        return true;
    }

    _clickItem(evt, item) {
        // Freeze or dblclick received
        if (this._freeze || evt.detail > 1) {
            // Force input element to keep checked status
            evt.currentTarget.checked = item.checked;
            return false;
        }

        // It is much more end2end test purpose
        // a playwright dblclick is 2 clicks with detail 0
        // and the dblclick which is a click with detail 2
        if (this._clickTimestamp && evt.timeStamp - this._clickTimestamp < 1) {
            // Force input element to keep checked status
            evt.currentTarget.checked = item.checked;
            return false;
        }
        this._clickTimestamp = evt.timeStamp;

        item.checked = !item.checked;
        return false;
    }

    _dblclickItem(item) {
        if (this._freeze) {
            return false;
        }

        this._freeze = true;
        item.propagateCheckedState(item.checked);
        this._freeze = false;
        this._onChange();
        return false;
    }

    _createGetMediaLink(path) {
        let url;
        // Test if the path is internal
        if (MEDIA_REGEX.test(path)) {
            const mediaLink = globalThis['lizUrls'].media + '?' + new URLSearchParams(globalThis['lizUrls'].params);
            url = mediaLink + '&path=/' + path;
        } else {
            url = path;
        }
        return url;
    }

    _createDocLink(layerName) {
        let url = lizMap.config.layers?.[layerName]?.link;
        return this._createGetMediaLink(url);
    }

    _createRemoveCacheLink(layerName) {
        if(!globalThis['lizUrls'].removeCache){
            return;
        }
        const removeCacheServerUrl = globalThis['lizUrls'].removeCache + '?' + new URLSearchParams(globalThis['lizUrls'].params);
        return removeCacheServerUrl + '&layer=' + layerName;
    }

    _removeCache(event) {
        if (! confirm(lizDict['tree.button.removeCache.confirmation'])){
            event.preventDefault();
        }
    }
}
