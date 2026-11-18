import { expect } from 'chai';

import { labelFeaturesUrl, MAX_LABEL_FEATURES } from 'assets/src/modules/LabelOverlay.js';

describe('LabelOverlay', function () {
    it('Reads the features of the visible extent with the WFS of the project', function () {
        const url = new URL(labelFeaturesUrl('http://localhost/index.php/lizmap/service',
            { repository: 'montpellier', project: 'events' }, 'grutas', [-9, 38, -8, 39]));
        expect(url.searchParams.get('repository')).to.equal('montpellier');
        expect(url.searchParams.get('TYPENAME')).to.equal('grutas');
        expect(url.searchParams.get('BBOX')).to.equal('-9,38,-8,39');
        expect(url.searchParams.get('MAXFEATURES')).to.equal(String(MAX_LABEL_FEATURES));
        const one = new URL(labelFeaturesUrl('http://localhost/service', {}, 'grutas'));
        expect(one.searchParams.get('MAXFEATURES')).to.equal('1');
        expect(one.searchParams.has('BBOX')).to.be.false;
    });
});
