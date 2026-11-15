// @ts-check
import { test, expect } from '@playwright/test';
import { ProjectPage } from './pages/project';

test.describe('Data catalog @readonly', () => {
    test('Catalog respects layer group visibility and adds layers to the map', async ({ page }) => {
        const project = new ProjectPage(page, 'base_layers');
        await project.open();

        await page.locator('#mapmenu li.catalog a').click();
        const catalog = page.locator('lizmap-catalog');
        await expect(catalog.locator('.catalog-repository').first()).toBeVisible();

        // Filter on the project title
        await catalog.locator('.catalog-filter').fill('Layer_group_visible_only');
        const mapEntry = catalog.locator('details.catalog-project', { hasText: 'Layer_group_visible_only' });
        await expect(mapEntry).toHaveCount(1);

        // Open the project: the layer only visible to admins is not listed
        const layersResponse = page.waitForResponse(r => r.url().includes('/catalog/layers'));
        await mapEntry.locator('summary').click();
        expect((await layersResponse).status()).toBe(200);
        const layers = mapEntry.locator('.catalog-layer-title');
        await expect(layers).toContainText(['sousquartiers', 'quartiers']);
        await expect(mapEntry.locator('.catalog-layer', { hasText: 'townhalls_only_visible_by_admins_group' })).toHaveCount(0);

        // Preview shows a thumbnail from the source project
        const quartiers = mapEntry.locator('.catalog-layer', { has: page.locator('.catalog-layer-title', { hasText: /^quartiers$/ }) });
        await quartiers.locator('.catalog-preview').click();
        const thumbnail = quartiers.locator('.catalog-thumbnail');
        await expect(thumbnail).toHaveAttribute('src', /REQUEST=GetMap.*LAYERS=quartiers/);

        // Add with the button: an external group is added to the layer tree
        const getMap = page.waitForRequest(r => r.url().includes('REQUEST=GetMap') && r.url().includes('LAYERS=quartiers')
            && !r.url().includes('WIDTH=280'));
        await quartiers.locator('.catalog-add').click();
        await getMap;
        await expect(quartiers).toHaveClass(/added/);
        await expect(page.getByTestId('ext-catalog-testsrepository~layer_group_visible_only')).toHaveCount(1);

        // Add by drag and drop onto the map
        const sousquartiers = mapEntry.locator('.catalog-layer', { hasText: 'sousquartiers' });
        await sousquartiers.dragTo(page.locator('#newOlMap'));
        await expect(sousquartiers).toHaveClass(/added/);

        // Remove both layers: the external group is removed
        await quartiers.locator('.catalog-remove').click();
        await sousquartiers.locator('.catalog-remove').click();
        await expect(page.getByTestId('ext-catalog-testsrepository~layer_group_visible_only')).toHaveCount(0);
    });

    test('Layers of an unknown project are not served @requests', async ({ request }) => {
        const response = await request.get('/index.php/lizmap/catalog/layers?repository=testsrepository&project=unknown');
        expect(response.status()).toBe(404);
    });
});
