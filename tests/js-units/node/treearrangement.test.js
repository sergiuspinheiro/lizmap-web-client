import { expect } from 'chai';

import TreeArrangement, { presetIcon } from 'assets/src/modules/TreeArrangement.js';

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

    it('Stores custom icons and resets', function () {
        const arrangement = new TreeArrangement('test');
        const icon = presetIcon('circle', '#e41a1c');
        expect(icon).to.match(/^data:image\/svg\+xml;base64,/);
        arrangement.setIcon('layer', icon);
        expect(new TreeArrangement('test').icon('layer')).to.equal(icon);
        arrangement.setIcon('layer', null);
        expect(arrangement.icon('layer')).to.be.undefined;
        expect(storage).to.not.have.property('test');

        arrangement.move('', ['a', 'b'], 'b', 'a', false);
        arrangement.reset(null);
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
        expect([layers.c.zIndex, layers.b.zIndex, layers.a.zIndex]).to.deep.equal([3, 2, 1]);

        arrangement.reset(root, map);
        expect([layers.a.zIndex, layers.b.zIndex, layers.c.zIndex]).to.deep.equal([3, 2, 1]);
    });
});
