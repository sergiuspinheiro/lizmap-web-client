import { expect } from 'chai';

import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';

import {
    GEOMETRY_CLASS, buildClasses, classifiableFields, defaultImportStyle,
    importStyleFunction, legendIcon, sanitizeImportStyle,
} from 'assets/src/modules/ImportStyle.js';

const dxfFeatures = () => [
    new Feature({ geometry: new Point([0, 0]), Layer: 'Muros', EntityHandle: '1' }),
    new Feature({ geometry: new LineString([[0, 0], [1, 1]]), Layer: 'Eixos', EntityHandle: '2' }),
    new Feature({ geometry: new LineString([[0, 0], [2, 2]]), Layer: 'Muros', EntityHandle: '3' }),
];

describe('ImportStyle', function () {
    it('Classifies AutoCAD files by layer', function () {
        const features = dxfFeatures();
        expect(classifiableFields(features)).to.deep.equal([GEOMETRY_CLASS, 'Layer', 'EntityHandle']);
        const style = defaultImportStyle(features, '#4363d8');
        expect(style.classifyBy).to.equal('Layer');
        expect(style.classes.map(c => c.value)).to.deep.equal(['Eixos', 'Muros']);
        expect(style.classes.every(c => c.visible)).to.be.true;
    });

    it('Classifies mixed geometries by type, else no classification', function () {
        const mixed = [new Feature({ geometry: new Point([0, 0]) }), new Feature({ geometry: new LineString([[0, 0], [1, 1]]) })];
        expect(defaultImportStyle(mixed, '#4363d8').classifyBy).to.equal(GEOMETRY_CLASS);
        expect(buildClasses(mixed, GEOMETRY_CLASS).map(c => c.value)).to.deep.equal(['line', 'point']);
        const points = [new Feature({ geometry: new Point([0, 0]), name: 'a' })];
        const style = defaultImportStyle(points, '#4363d8');
        expect(style.classifyBy).to.equal('');
        expect(style.classes).to.be.empty;
    });

    it('Hides the features of hidden classes', function () {
        const features = dxfFeatures();
        const style = defaultImportStyle(features, '#4363d8');
        style.classes = buildClasses(features, 'Layer', [{ value: 'Muros', color: '#000000', visible: false }]);
        const fn = importStyleFunction(style);
        expect(fn(features[0])).to.be.undefined;
        expect(fn(features[1]).getStroke().getColor()).to.equal(style.classes[0].color);
        expect(fn(features[2])).to.be.undefined;
    });

    it('Checks the styles read from storage', function () {
        expect(sanitizeImportStyle(null, '#4363d8')).to.be.null;
        const style = sanitizeImportStyle({
            color: 'red;x', width: 100, fillOpacity: -1, classifyBy: 'Layer',
            classes: [{ value: 'A', color: '#00ff00' }, { value: 'B', color: 'javascript:' }],
        }, '#4363d8');
        expect(style.color).to.equal('#4363d8');
        expect(style.width).to.equal(20);
        expect(style.fillOpacity).to.equal(0);
        expect(style.classes).to.deep.equal([{ value: 'A', color: '#00ff00', visible: true }]);
        expect(legendIcon('#00ff00', 'point')).to.match(/^data:image\/svg\+xml;base64,/);
    });
});
