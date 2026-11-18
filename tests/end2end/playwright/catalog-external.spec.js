// @ts-check
import { test, expect } from '@playwright/test';
import { ProjectPage } from './pages/project';

// 1x1 transparent PNG
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

const WMS_CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>Ortos</Title></Service>
  <Capability><Layer><Title>Root</Title>
    <Layer><Name>Ortos2025-RGB</Name><Title>Ortofotos 2025</Title></Layer>
    <Layer><Name>Ortos2025-IRG</Name><Title>Ortofotos 2025 infravermelho</Title></Layer>
  </Layer></Capability>
</WMS_Capabilities>`;

const OGC_COLLECTIONS = JSON.stringify({
    title: 'Features',
    collections: [{ id: 'roads', title: 'Roads' }],
});

const OGC_ITEMS = JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Point', coordinates: [3.88, 43.61] } }],
});

test.describe('Data catalog external services @readonly', () => {
    test('Add WMS and OGC API Features layers', async ({ page }) => {
        const requests = [];
        await page.route('https://wms.example.com/**', async route => {
            const params = new URL(route.request().url()).searchParams;
            if (params.get('REQUEST') === 'GetCapabilities') {
                await route.fulfill({ contentType: 'text/xml', body: WMS_CAPABILITIES });
                return;
            }
            requests.push(params.get('LAYERS'));
            await route.fulfill({ contentType: 'image/png', body: PNG });
        });
        await page.route('https://api.example.com/**', async route => {
            const url = new URL(route.request().url());
            requests.push(url.pathname);
            await route.fulfill({
                contentType: 'application/json',
                body: url.pathname.endsWith('/items') ? OGC_ITEMS : OGC_COLLECTIONS,
            });
        });

        const project = new ProjectPage(page, 'base_layers');
        await project.open();
        await page.locator('#mapmenu li.catalog a').click();
        const external = page.locator('lizmap-catalog details.catalog-external');
        await external.locator('summary').click();

        // WMS
        await external.locator('.catalog-external-url').fill('https://wms.example.com/wms/ortos2025');
        await external.locator('.catalog-external-load').click();
        const layers = external.locator('.catalog-external-layer .catalog-layer-title');
        await expect(layers).toHaveText(['Ortofotos 2025', 'Ortofotos 2025 infravermelho']);
        await external.locator('.catalog-external-layer', { hasText: 'infravermelho' }).locator('.catalog-add').click();
        await expect.poll(() => requests.includes('Ortos2025-IRG')).toBe(true);
        await expect(page.getByTestId('ext-external-wms|https://wms.example.com/wms/ortos2025')).toHaveCount(1);

        // OGC API Features
        await external.locator('.catalog-external-type').selectOption('ogcapi');
        await external.locator('.catalog-external-url').fill('https://api.example.com/ogc');
        await external.locator('.catalog-external-load').click();
        await expect(layers).toHaveText(['Roads']);
        await external.locator('.catalog-external-layer .catalog-add').click();
        await expect.poll(() => requests.includes('/ogc/collections/roads/items')).toBe(true);
        await expect(page.getByTestId('ext-external-ogcapi|https://api.example.com/ogc')).toHaveCount(1);

        // Remove
        await external.locator('.catalog-external-layer .catalog-remove').click();
        await expect(page.getByTestId('ext-external-ogcapi|https://api.example.com/ogc')).toHaveCount(0);
    });
});
