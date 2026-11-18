import { expect } from 'chai';

import TreeArrangement from 'assets/src/modules/TreeArrangement.js';

describe('TreeArrangement', function () {
    let storage;
    beforeEach(function () {
        storage = {};
        globalThis.window = globalThis.window || {};
        window.localStorage = {
            getItem: key => storage[key] ?? null,
            setItem: (key, value) => { storage[key] = value; },
            removeItem: key => { delete storage[key]; },
        };
    });

    it('Keeps the project order when nothing is saved', function () {
        const arrangement = new TreeArrangement('test');
        const children = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
        expect(arrangement.sortChildren('', children).map(c => c.name)).to.deep.equal(['a', 'b', 'c']);
        expect(arrangement.isCustomized).to.be.false;
    });

    it('Moves an item inside its group and saves it', function () {
        const arrangement = new TreeArrangement('test');
        expect(arrangement.move('g', ['a', 'b', 'c'], 'c', 'a', false)).to.be.true;
        expect(arrangement.sortChildren('g', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]).map(c => c.name))
            .to.deep.equal(['c', 'a', 'b']);
        expect(arrangement.move('g', ['c', 'a', 'b'], 'c', 'b', true)).to.be.true;
        expect(arrangement.sortChildren('g', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]).map(c => c.name))
            .to.deep.equal(['a', 'b', 'c']);
        // Other groups are not changed
        expect(arrangement.sortChildren('', [{ name: 'c' }, { name: 'a' }]).map(c => c.name)).to.deep.equal(['c', 'a']);
        // Not a sibling
        expect(arrangement.move('g', ['a', 'b'], 'a', 'z', false)).to.be.false;

        const reloaded = new TreeArrangement('test');
        expect(reloaded.sortChildren('g', [{ name: 'a' }, { name: 'c' }, { name: 'b' }]).map(c => c.name))
            .to.deep.equal(['a', 'b', 'c']);
    });

    it('Exports, replaces and resets the order', function () {
        const arrangement = new TreeArrangement('test');
        arrangement.move('', ['a', 'b'], 'b', 'a', false);
        expect(arrangement.order).to.deep.equal({ '': ['b', 'a'] });

        arrangement.setOrder({ g: ['y', 'x', 3], bad: 'x' }, null, null);
        expect(arrangement.order).to.deep.equal({ g: ['y', 'x'] });
        expect(new TreeArrangement('test').order).to.deep.equal({ g: ['y', 'x'] });

        arrangement.reset(null, null);
        expect(arrangement.isCustomized).to.be.false;
        expect(storage).to.not.have.property('test');
    });
});

describe('TreeArrangement drawing order', function () {
    it('Reassigns the project zIndex values following the tree order', function () {
        globalThis.window = globalThis.window || {};
        const storage = {};
        window.localStorage = {
            getItem: key => storage[key] ?? null,
            setItem: (key, value) => { storage[key] = value; },
            removeItem: key => { delete storage[key]; },
        };
        const olLayer = (name, zIndex) => {
            const props = { name };
            return {
                zIndex,
                get: key => props[key],
                set: (key, value) => { props[key] = value; },
                getZIndex() { return this.zIndex; },
                setZIndex(value) { this.zIndex = value; },
            };
        };
        const layers = { a: olLayer('a', 3), b: olLayer('b', 2), c: olLayer('c', 1) };
        const map = { getLayerByName: name => layers[name], statesSingleWMSLayers: new Map() };
        const root = {
            children: [
                { type: 'layer', name: 'a' },
                { type: 'group', name: 'g', children: [{ type: 'layer', name: 'b' }, { type: 'layer', name: 'c' }] },
            ],
        };
        const arrangement = new TreeArrangement('order');
        arrangement.move('g', ['b', 'c'], 'c', 'b', false);
        arrangement.move('', ['a', 'g'], 'a', 'g', true);
        arrangement.applyDrawingOrder(root, map);
        expect(layers.c.zIndex).to.be.above(layers.b.zIndex);
        expect(layers.b.zIndex).to.be.above(layers.a.zIndex);
        expect(layers.a.zIndex).to.be.above(0);
        expect(layers.c.zIndex).to.be.at.most(4);

        arrangement.reset(root, map);
        expect([layers.a.zIndex, layers.b.zIndex, layers.c.zIndex]).to.deep.equal([3, 2, 1]);
    });

    it('Orders the layers of the external groups', function () {
        const storage = {};
        window.localStorage = {
            getItem: key => storage[key] ?? null,
            setItem: (key, value) => { storage[key] = value; },
            removeItem: key => { delete storage[key]; },
        };
        const olLayer = (name, zIndex) => {
            const props = { name };
            return {
                zIndex,
                get: key => props[key],
                set: (key, value) => { props[key] = value; },
                getZIndex() { return this.zIndex; },
                setZIndex(value) { this.zIndex = value; },
            };
        };
        const layers = { a: olLayer('a', 2), b: olLayer('b', 1), x: olLayer('x'), y: olLayer('y') };
        const map = { getLayerByName: name => layers[name], statesSingleWMSLayers: new Map() };
        const root = {
            children: [
                { type: 'ext-group', name: 'catalog', children: [
                    { name: 'x', mapItemState: { olLayer: layers.x } },
                    { name: 'y', mapItemState: { olLayer: layers.y } },
                ] },
                { type: 'layer', name: 'a' },
                { type: 'layer', name: 'b' },
            ],
        };
        const arrangement = new TreeArrangement('ext');
        // The catalog group between a and b, y above x
        arrangement.move('', ['catalog', 'a', 'b'], 'catalog', 'a', true);
        arrangement.move(TreeArrangement.externalKey('catalog'), ['x', 'y'], 'y', 'x', false);
        arrangement.applyDrawingOrder(root, map);
        expect(layers.a.zIndex).to.be.above(layers.y.zIndex);
        expect(layers.y.zIndex).to.be.above(layers.x.zIndex);
        expect(layers.x.zIndex).to.be.above(layers.b.zIndex);

        arrangement.reset(root, map);
        expect([layers.a.zIndex, layers.b.zIndex]).to.deep.equal([2, 1]);
        expect(layers.x.zIndex).to.be.undefined;
    });
});
