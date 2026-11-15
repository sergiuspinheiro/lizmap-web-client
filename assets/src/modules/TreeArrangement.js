/**
 * @module modules/TreeArrangement.js
 * @name TreeArrangement
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

/** Colors of the preset icons */
export const ICON_COLORS = ['#e41a1c', '#ff7f00', '#ffd92f', '#4daf4a', '#1f78b4', '#984ea3', '#a65628', '#555555'];

/** Shapes of the preset icons, as SVG elements */
const ICON_SHAPES = {
    circle: color => `<circle cx="8" cy="8" r="6" fill="${color}" stroke="#333"/>`,
    square: color => `<rect x="2" y="2" width="12" height="12" fill="${color}" stroke="#333"/>`,
    triangle: color => `<path d="M8 2 L14 14 L2 14 Z" fill="${color}" stroke="#333"/>`,
    line: color => `<path d="M2 12 L6 5 L10 10 L14 3" fill="none" stroke="${color}" stroke-width="2.5"/>`,
};

/** Maximum size of an uploaded icon, as a data URL */
export const MAX_ICON_LENGTH = 100000;

/**
 * Build a preset icon as an SVG data URL
 * @param {string} shape - one of the ICON_SHAPES keys
 * @param {string} color - CSS color
 * @returns {string} the data URL
 */
export function presetIcon(shape, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${ICON_SHAPES[shape](color)}</svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
}

/** @type {string[]} */
export const ICON_SHAPE_NAMES = Object.keys(ICON_SHAPES);

/**
 * User arrangement of the layer tree: order of the items inside each group
 * and custom icons of layers and groups. It is stored in the browser, per
 * project, and does not change the project.
 * @class
 * @name TreeArrangement
 */
export default class TreeArrangement {
    /**
     * Load the arrangement saved in the browser
     * @param {string} storageKey - the browser storage key
     */
    constructor(storageKey) {
        this._storageKey = storageKey;
        this._active = false;
        // parent name => ordered children names
        this._order = {};
        // item name => icon URL
        this._icons = {};
        try {
            const saved = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
            this._order = saved.order || {};
            this._icons = saved.icons || {};
        } catch (error) {
            console.warn(error);
        }
    }

    /**
     * Arrange mode: drag handles and icon pickers are displayed
     * @type {boolean}
     */
    get active() {
        return this._active;
    }

    set active(value) {
        this._active = !!value;
    }

    /**
     * The user has changed the tree
     * @type {boolean}
     */
    get isCustomized() {
        return Object.keys(this._order).length > 0 || Object.keys(this._icons).length > 0;
    }

    _save() {
        try {
            if (this.isCustomized) {
                window.localStorage.setItem(this._storageKey, JSON.stringify({ order: this._order, icons: this._icons }));
            } else {
                window.localStorage.removeItem(this._storageKey);
            }
        } catch (error) {
            console.warn(error);
        }
    }

    /**
     * Sort the children of a group following the user order.
     * Items unknown to the saved order keep their place.
     * @param {string} parentName - the group name, empty for the root
     * @param {Array<{name: string}>} children - the children in the project order
     * @returns {Array<{name: string}>} the children in the user order
     */
    sortChildren(parentName, children) {
        const order = this._order[parentName];
        if (!order) {
            return children;
        }
        const rank = (item, index) => {
            const i = order.indexOf(item.name);
            return i === -1 ? index : i;
        };
        return children
            .map((item, index) => ({ item, rank: rank(item, index), index }))
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .map(entry => entry.item);
    }

    /**
     * Move an item before or after one of its siblings
     * @param {string} parentName - the group name, empty for the root
     * @param {string[]} siblingNames - the children names in the displayed order
     * @param {string} name - the moved item
     * @param {string} targetName - the sibling to drop on
     * @param {boolean} after - drop after the sibling instead of before
     * @returns {boolean} true if the order changed
     */
    move(parentName, siblingNames, name, targetName, after) {
        if (name === targetName || !siblingNames.includes(name) || !siblingNames.includes(targetName)) {
            return false;
        }
        const names = siblingNames.filter(n => n !== name);
        names.splice(names.indexOf(targetName) + (after ? 1 : 0), 0, name);
        this._order[parentName] = names;
        this._save();
        return true;
    }

    /**
     * Custom icon of an item
     * @param {string} name - the layer or group name
     * @returns {string|undefined} the icon URL
     */
    icon(name) {
        return this._icons[name];
    }

    /**
     * Set or remove the custom icon of an item
     * @param {string} name - the layer or group name
     * @param {string|null} url - the icon URL, null to remove it
     */
    setIcon(name, url) {
        if (url) {
            this._icons[name] = url;
        } else {
            delete this._icons[name];
        }
        this._save();
    }

    /**
     * Forget the user arrangement
     * @param {object} layerTreeRoot - the layer tree root, to restore the drawing order
     * @param {object} map - the Lizmap OpenLayers map
     */
    reset(layerTreeRoot, map) {
        this._order = {};
        this._icons = {};
        this._save();
        this.applyDrawingOrder(layerTreeRoot, map);
    }

    /**
     * Draw the map layers in the order displayed by the tree: the zIndex
     * values given by the project are reassigned following the tree order.
     * Layers drawn in a single WMS image keep the project order.
     * @param {object} layerTreeRoot - the layer tree root
     * @param {object} map - the Lizmap OpenLayers map
     */
    applyDrawingOrder(layerTreeRoot, map) {
        if (!map || !layerTreeRoot) {
            return;
        }
        const olLayers = [];
        const collect = (group) => {
            for (const item of this.sortChildren(group.name ?? '', group.children)) {
                if (item.type === 'group') {
                    collect(item);
                } else if (item.type === 'layer' && !map.statesSingleWMSLayers?.get(item.name)) {
                    const olLayer = map.getLayerByName(item.name);
                    if (olLayer) {
                        if (olLayer.get('lizmapProjectZIndex') === undefined) {
                            olLayer.set('lizmapProjectZIndex', olLayer.getZIndex());
                        }
                        olLayers.push(olLayer);
                    }
                }
            }
        };
        collect({ name: '', children: layerTreeRoot.children });
        const zIndexes = olLayers.map(l => l.get('lizmapProjectZIndex')).sort((a, b) => b - a);
        olLayers.forEach((olLayer, i) => olLayer.setZIndex(zIndexes[i]));
    }
}
