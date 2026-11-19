import { expect } from 'chai';
import MultiSnap from 'assets/src/modules/interaction/MultiSnap.js';
import { Vector as VectorSource } from 'ol/source.js';
import { Feature } from 'ol';
import { Point, LineString } from 'ol/geom.js';

// map with 1 map unit = 1 pixel
const map = {
    getView: () => ({ getResolution: () => 1 }),
    getPixelFromCoordinate: (c) => [c[0], 0 - c[1] + 0],
};

describe('MultiSnap', function () {
    const points = new VectorSource();
    points.addFeature(new Feature(new Point([5, 0])));
    const edges = new VectorSource();
    edges.addFeature(new Feature(new LineString([[0, 0], [10, 0]])));

    it('Points first, then segments', function () {
        const snap = new MultiSnap({ pointsSource: points, edgesSource: edges, pixelTolerance: 3 });
        // close to the point
        let result = snap.snapTo([6, -1], [6, 1], map);
        expect(result.coordinate).to.deep.equal([5, 0]);
        // close to the segment only
        result = snap.snapTo([8, -2], [8, 2], map);
        expect(result.coordinate).to.deep.equal([8, 0]);
        // too far
        expect(snap.snapTo([8, -5], [8, 5], map)).to.be.null;
    });

    it('Without segments', function () {
        const snap = new MultiSnap({ pointsSource: points, edgesSource: edges, pixelTolerance: 3, edges: false });
        expect(snap.snapTo([8, -2], [8, 2], map)).to.be.null;
        expect(snap.snapTo([5, -2], [5, 2], map).coordinate).to.deep.equal([5, 0]);
    });

    it('Changes the event', function () {
        const snap = new MultiSnap({ pointsSource: points, edgesSource: edges, pixelTolerance: 3 });
        const evt = { type: 'pointermove', pixel: [6, -1], coordinate: [6, 1], map: map };
        expect(snap.handleEvent(evt)).to.be.true;
        expect(evt.coordinate).to.deep.equal([5, 0]);
        expect(evt.pixel.map(Math.abs)).to.deep.equal([5, 0]);
    });
});
