import { expect } from 'chai';

import { readFiles, IMPORT_ACCEPT, isGeographic, normalizeCrs, reprojectFeatures } from 'assets/src/modules/FileImport.js';

describe('FileImport', function () {
    before(function () {
        globalThis.lizDict = globalThis.lizDict || {};
        globalThis.lizDict['catalog.import.format'] = 'Unsupported file format';
        globalThis.lizDict['catalog.import.shp.missing'] = 'The .shp file is missing';
        globalThis.lizDict['catalog.import.crs.missing'] = 'import cancelled';
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

    it('Detects coordinates that are not longitudes and latitudes', function () {
        expect(isGeographic({ type: 'Point', coordinates: [-8.6, 41.1] })).to.be.true;
        expect(isGeographic({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-8, 40], [-41316.6, 165270.4]] } }],
        })).to.be.false;
        expect(isGeographic({ type: 'FeatureCollection', features: [] })).to.be.true;
    });

    it('Normalizes EPSG codes typed by the user', function () {
        expect(normalizeCrs('3763')).to.equal('EPSG:3763');
        expect(normalizeCrs(' epsg:20790 ')).to.equal('EPSG:20790');
        expect(normalizeCrs('EPSG:3763 x')).to.be.null;
        expect(normalizeCrs('')).to.be.null;
    });

    it('Asks the CRS of GeoJSON files with projected coordinates', async function () {
        const geojson = JSON.stringify({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-41316.6, 165270.4] } }],
        });
        const asked = [];
        const { layers, errors } = await readFiles([new File([geojson], 'grutas.geojson')], 'EPSG:4326', name => {
            asked.push(name);
            return Promise.resolve('EPSG:3763');
        });
        expect(asked).to.deep.equal(['grutas.geojson']);
        expect(errors).to.be.empty;
        expect(layers[0].fileName).to.equal('grutas.geojson');
        expect(layers[0].crs).to.equal('EPSG:3763');
        const [lon, lat] = layers[0].features[0].getGeometry().getCoordinates();
        expect(lon).to.be.closeTo(-8.6253, 0.0001);
        expect(lat).to.be.closeTo(41.1556, 0.0001);

        const cancelled = await readFiles([new File([geojson], 'grutas.geojson')], 'EPSG:4326', () => Promise.resolve(null));
        expect(cancelled.layers).to.be.empty;
        expect(cancelled.errors).to.deep.equal(['grutas.geojson: import cancelled']);
    });

    it('Asks the CRS when the server needs it', async function () {
        const savedFetch = globalThis.fetch;
        const savedUrls = globalThis.lizUrls;
        const sent = [];
        globalThis.lizUrls = { convert: '/convert', params: { repository: 'r', project: 'p' } };
        globalThis.fetch = async (url, options) => {
            const crs = options.body.get('crs');
            sent.push(crs);
            if (!crs) {
                return new Response(JSON.stringify({ error: 'crs', crsRequired: true }), { status: 422 });
            }
            return new Response(JSON.stringify({
                type: 'FeatureCollection',
                features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-8, 40] } }],
            }));
        };
        try {
            const { layers, errors } = await readFiles(
                [new File(['0'], 'plan.dxf')], 'EPSG:4326', () => Promise.resolve('EPSG:20790')
            );
            expect(errors).to.be.empty;
            expect(sent).to.deep.equal(['', 'EPSG:20790']);
            expect(layers[0].name).to.equal('plan');
        } finally {
            globalThis.fetch = savedFetch;
            globalThis.lizUrls = savedUrls;
        }
    });

    it('Reads again the coordinates in another CRS', async function () {
        const geojson = JSON.stringify({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-41316.6, 165270.4] } }],
        });
        // The user chose ETRS89 / UTM 29N, but the coordinates are in PT-TM06
        const { layers } = await readFiles([new File([geojson], 'grutas.geojson')], 'EPSG:4326', () => Promise.resolve('EPSG:25829'));
        await reprojectFeatures(layers[0].features, 'EPSG:25829', 'EPSG:3763', 'EPSG:4326');
        const [lon, lat] = layers[0].features[0].getGeometry().getCoordinates();
        expect(lon).to.be.closeTo(-8.6253, 0.0001);
        expect(lat).to.be.closeTo(41.1556, 0.0001);
    });
});
