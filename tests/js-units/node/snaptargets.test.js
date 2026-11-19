import { expect } from 'chai';
import { computeSnapPoints, snapCandidateLayers, SnapModes } from 'assets/src/modules/SnapTargets.js';

const feature = (geometry) => ({ type: 'Feature', properties: {}, geometry: geometry });

describe('SnapTargets', function () {

    it('Modes', function () {
        expect(SnapModes).to.deep.equal(['vertices', 'segments', 'midpoints', 'intersections']);
    });

    it('Vertices and midpoints', function () {
        const features = [
            feature({ type: 'LineString', coordinates: [[0, 0], [10, 0], [10, 10]] }),
            feature({ type: 'Point', coordinates: [5, 5] }),
        ];
        const points = computeSnapPoints(features, { vertices: true, midpoints: true, intersections: false });
        expect(points.vertices).to.deep.equal([[5, 5], [0, 0], [10, 0], [10, 10]]);
        expect(points.midpoints).to.deep.equal([[5, 0], [10, 5]]);
        expect(points.intersections).to.have.length(0);

        const none = computeSnapPoints(features, { vertices: false, midpoints: false, intersections: false });
        expect(none.vertices).to.have.length(0);
        expect(none.midpoints).to.have.length(0);
    });

    it('Intersections', function () {
        const features = [
            // a cross
            feature({ type: 'LineString', coordinates: [[0, 0], [10, 10]] }),
            feature({ type: 'LineString', coordinates: [[0, 10], [10, 0]] }),
            // a polygon crossed by a line
            feature({ type: 'Polygon', coordinates: [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]] }),
            feature({ type: 'LineString', coordinates: [[15, 5], [35, 5]] }),
        ];
        const points = computeSnapPoints(features, { vertices: false, midpoints: false, intersections: true });
        const sorted = points.intersections
            .map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000])
            .sort((a, b) => a[0] - b[0]);
        expect(sorted).to.deep.equal([[5, 5], [20, 5], [30, 5]]);
    });

    it('Shared vertices are not intersections', function () {
        const features = [
            feature({ type: 'LineString', coordinates: [[0, 0], [10, 0], [10, 10]] }),
            feature({ type: 'MultiPolygon', coordinates: [[[[0, 0], [-1, 0], [-1, -1], [0, 0]]]] }),
        ];
        const points = computeSnapPoints(features, { vertices: false, midpoints: false, intersections: true });
        expect(points.intersections).to.have.length(0);
    });

    it('A line ending on a segment', function () {
        const features = [
            feature({ type: 'LineString', coordinates: [[0, 0], [10, 0]] }),
            feature({ type: 'LineString', coordinates: [[5, 5], [5, 0]] }),
        ];
        const points = computeSnapPoints(features, { vertices: false, midpoints: false, intersections: true });
        expect(points.intersections).to.deep.equal([[5, 0]]);
    });

    it('Candidate layers', function () {
        const lizmap3 = {
            config: {
                layers: {
                    'roads': { id: 'roads_id', title: 'Roads', geometryType: 'line' },
                    'table': { id: 'table_id', title: 'Table', geometryType: 'none' },
                    'buildings': { id: 'buildings_id', title: 'Buildings', geometryType: 'polygon' },
                },
            },
            getNameByTypeName: (typeName) => typeName,
        };
        const layers = snapCandidateLayers(lizmap3, [
            { Name: 'roads' }, { Name: 'table' }, { Name: 'buildings' }, { Name: 'unknown' },
        ]);
        expect(layers.map(l => l.id)).to.deep.equal(['buildings_id', 'roads_id']);
    });
});
