import { expect } from 'chai';

import { serviceStyles } from 'assets/src/modules/ExternalServices.js';

describe('ExternalServices', function () {
    it('Gives the styles of WMS and WMTS layers', function () {
        expect(serviceStyles('wms', 'roads', { styles: { roads: [{ name: 'default', title: 'Default' }, { name: 'dark', title: 'Dark' }] } }))
            .to.have.length(2);
        expect(serviceStyles('wms', 'other', { styles: {} })).to.deep.equal([]);
        const wmts = { Contents: { Layer: [{ Identifier: 'ortho', Style: [{ Identifier: 'normal', Title: 'Normal' }, { Identifier: 'ir' }] }] } };
        expect(serviceStyles('wmts', 'ortho', wmts)).to.deep.equal([
            { name: 'normal', title: 'Normal' }, { name: 'ir', title: 'ir' },
        ]);
        expect(serviceStyles('wfs', 'x', null)).to.deep.equal([]);
    });
});
