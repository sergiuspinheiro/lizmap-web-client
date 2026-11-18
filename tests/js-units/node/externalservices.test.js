import { expect } from 'chai';

import { arcgisDirectory, serviceName, serviceStyles } from 'assets/src/modules/ExternalServices.js';

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

    it('Gives a readable name to a service without title', function () {
        expect(serviceName('https://services8.arcgis.com/ITVSIrZ4rxt6SbBo/arcgis/rest/services/PAMS_SitArq_20261101/FeatureServer'))
            .to.equal('PAMS SitArq 20261101');
        expect(serviceName('https://a.com/geoserver/ortos/wms')).to.equal('ortos');
        expect(serviceName('https://tiles.a.com/{z}/{x}/{y}.png')).to.equal('tiles.a.com');
        expect(serviceName('https://a.com/data/sitios_arq.geojson')).to.equal('sitios arq');
    });

    it('Lists the services of an ArcGIS directory', function () {
        const base = 'https://services8.arcgis.com/ITVSIrZ4rxt6SbBo/ArcGIS/rest/services/';
        expect(arcgisDirectory({
            folders: ['Base'],
            services: [{ name: 'PAMS_SitArq_20261101', type: 'FeatureServer' }, { name: 'Geometry', type: 'GeometryServer' }],
        }, base)).to.deep.equal([
            { url: 'https://services8.arcgis.com/ITVSIrZ4rxt6SbBo/ArcGIS/rest/services/Base', title: 'Base', folder: true },
            {
                url: 'https://services8.arcgis.com/ITVSIrZ4rxt6SbBo/ArcGIS/rest/services/PAMS_SitArq_20261101/FeatureServer',
                title: 'PAMS SitArq 20261101 (FeatureServer)', folder: false,
            },
        ]);
        // In a folder, the names start with the folder
        expect(arcgisDirectory({ services: [{ name: 'Base/Ortos', type: 'MapServer' }] }, 'https://a.com/arcgis/rest/services/Base')[0].url)
            .to.equal('https://a.com/arcgis/rest/services/Base/Ortos/MapServer');
    });
});
