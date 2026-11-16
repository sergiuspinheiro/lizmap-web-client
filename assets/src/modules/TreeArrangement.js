/**
 * @module modules/TreeArrangement.js
 * @name TreeArrangement
 * @copyright 2026 3Liz
 * @license MPL-2.0
 */

/**
 * User arrangement of the layer tree: order of the items inside each group.
 * It is stored in the browser, per project, and does not change the project.
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
        try {
            const saved = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
            this._order = saved.order || {};
        } catch (error) {
            console.warn(error);
        }
    }

    /**
     * Arrange mode: the items can be dragged
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
        return Object.keys(this._order).length > 0;
    }

    _save() {
        try {
            if (this.isCustomized) {
                window.localStorage.setItem(this._storageKey, JSON.stringify({ order: this._order }));
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
     * The user order: parent name => ordered children names
     * @type {object}
     */
    get order() {
        return structuredClone(this._order);
    }

    /**
     * Replace the user order, for instance by a saved configuration
     * @param {object} order - parent name => ordered children names
     * @param {object} layerTreeRoot - the layer tree root, to apply the drawing order
     * @param {object} map - the Lizmap OpenLayers map
     */
    setOrder(order, layerTreeRoot, map) {
        this._order = {};
        for (const [parent, names] of Object.entries(order || {})) {
            if (Array.isArray(names)) {
                this._order[parent] = names.filter(name => typeof name === 'string');
            }
        }
        this._save();
        this.applyDrawingOrder(layerTreeRoot, map);
    }

    /**
     * Forget the user arrangement
     * @param {object} layerTreeRoot - the layer tree root, to restore the drawing order
     * @param {object} map - the Lizmap OpenLayers map
     */
    reset(layerTreeRoot, map) {
        this._order = {};
        this._save();
        this.applyDrawingOrder(layerTreeRoot, map);
    }

    /**
     * Key of the children of an external group, as layers added from the
     * data catalog, in the arrangement
     * @param {string} name - the external group name
     * @returns {string} the key
     */
    static externalKey(name) {
        return 'ext:' + name;
    }

    /**
     * Draw the map layers in the order displayed by the tree, including
     * the layers of the external groups, as the layers added from the data
     * catalog. Layers drawn in a single WMS image keep the project order.
     * @param {object} layerTreeRoot - the layer tree root
     * @param {object} map - the Lizmap OpenLayers map
     */
    applyDrawingOrder(layerTreeRoot, map) {
        if (!map || !layerTreeRoot) {
            return;
        }
        // OpenLayers layers in the displayed order, from the top
        const olLayers = [];
        const externalLayers = [];
        const collect = (group) => {
            for (const item of this.sortChildren(group.name ?? '', group.children)) {
                if (item.type === 'group') {
                    collect(item);
                } else if (item.type === 'ext-group') {
                    const key = TreeArrangement.externalKey(item.name);
                    for (const child of this.sortChildren(key, item.children)) {
                        const olLayer = child.mapItemState?.olLayer ?? child.olLayer;
                        if (olLayer) {
                            olLayers.push(olLayer);
                            externalLayers.push(olLayer);
                        }
                    }
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
        const projectLayers = olLayers.filter(l => !externalLayers.includes(l));
        if (!this.isCustomized) {
            // Project order, the external layers above the project layers
            projectLayers.forEach(l => l.setZIndex(l.get('lizmapProjectZIndex')));
            externalLayers.forEach(l => l.setZIndex(undefined));
            return;
        }
        // Values between the base layers (0) and above the highest project
        // layer, below the tools layers (highlight, digitizing...)
        const top = Math.max(0, ...projectLayers.map(l => l.get('lizmapProjectZIndex') ?? 0)) + 1;
        olLayers.forEach((olLayer, i) => olLayer.setZIndex(top * (olLayers.length - i) / olLayers.length));
    }
}
