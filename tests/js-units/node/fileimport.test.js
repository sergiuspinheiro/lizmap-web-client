import { expect } from 'chai';

import { readFiles, IMPORT_ACCEPT } from 'assets/src/modules/FileImport.js';

describe('FileImport', function () {
    before(function () {
        globalThis.lizDict = globalThis.lizDict || {};
        globalThis.lizDict['catalog.import.format'] = 'Unsupported file format';
        globalThis.lizDict['catalog.import.shp.missing'] = 'The .shp file is missing';
    });

    it('Accepts the common formats', function () {
        for (const ext of ['.geojson', '.kml', '.gpx', '.zip', '.shp', '.dbf', '.gpkg', '.dxf', '.csv']) {
            expect(IMPORT_ACCEPT.split(',')).to.include(ext);
        }
    });

    it('Reads GeoJSON files in the browser, one layer per file', async function () {
        const geojson = JSON.stringify({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: { a: 1 }, geometry: { type: 'Point', coordinates: [-8, 40] } }],
        });
        const { layers, errors } = await readFiles([new File([geojson], 'points.geojson')], 'EPSG:3857');
        expect(errors).to.be.empty;
        expect(layers).to.have.length(1);
        expect(layers[0].name).to.equal('points');
        expect(layers[0].features).to.have.length(1);
        expect(layers[0].features[0].getGeometry().getCoordinates()[0]).to.be.closeTo(-890555.93, 0.1);
    });

    it('Reports unsupported files and shapefiles without .shp', async function () {
        const { layers, errors } = await readFiles(
            [new File(['x'], 'notes.txt'), new File(['x'], 'roads.dbf')], 'EPSG:3857'
        );
        expect(layers).to.be.empty;
        expect(errors).to.deep.equal(['roads.shp: The .shp file is missing', 'notes.txt: Unsupported file format']);
    });
});
