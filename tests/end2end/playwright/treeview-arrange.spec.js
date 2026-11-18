// @ts-check
import { test, expect } from '@playwright/test';
import { ProjectPage } from './pages/project';
import { getAuthStorageStatePath } from './globals';

const GROUP = 'group with space in name and shortname defined';

test.describe('Treeview reorder @readonly', () => {
    test('Reorder layers, kept in the browser', async ({ page }) => {
        const project = new ProjectPage(page, 'treeview');
        await project.open();

        const titles = page.getByTestId(GROUP).locator(':scope > ul > li .node > label');
        await expect(titles).toHaveText(['quartiers', 'shop_bakery_pg']);

        // Out of reorder mode the items are not draggable
        await expect(page.getByTestId('quartiers')).toHaveAttribute('draggable', 'false');

        await page.locator('#layers-arrange').click();
        await expect(page.locator('lizmap-treeview .tree-arrange-bar')).toBeVisible();
        // Anonymous users can't save views
        await expect(page.locator('lizmap-mapviews .mapviews-login')).toBeVisible();

        // Move shop_bakery_pg above quartiers
        await page.getByTestId('shop_bakery_pg').dragTo(page.getByTestId('quartiers'), {
            targetPosition: { x: 20, y: 2 },
        });
        await expect(titles).toHaveText(['shop_bakery_pg', 'quartiers']);

        // The order is kept after a reload
        await page.reload();
        await expect(titles).toHaveText(['shop_bakery_pg', 'quartiers']);

        // Restore the project tree
        await page.locator('#layers-arrange').click();
        await page.locator('lizmap-treeview .tree-arrange-reset').click();
        await expect(titles).toHaveText(['quartiers', 'shop_bakery_pg']);
    });
});

test.describe('Saved map views @write', () => {
    test.use({ storageState: getAuthStorageStatePath('admin') });

    test('Save and load the layer order and catalog layers', async ({ page }) => {
        const project = new ProjectPage(page, 'treeview');
        await project.open();
        const titles = page.getByTestId(GROUP).locator(':scope > ul > li .node > label');

        // Reorder and add a catalog layer
        await page.locator('#layers-arrange').click();
        await page.getByTestId('shop_bakery_pg').dragTo(page.getByTestId('quartiers'), {
            targetPosition: { x: 20, y: 2 },
        });
        await page.locator('#mapmenu li.catalog a').click();
        const catalog = page.locator('lizmap-catalog');
        await catalog.locator('.catalog-filter').fill('Layer_group_visible_only');
        const mapEntry = catalog.locator('details.catalog-project', { hasText: 'Layer_group_visible_only' });
        await mapEntry.locator('summary').click();
        await mapEntry.locator('.catalog-layer', { hasText: 'sousquartiers' }).locator('.catalog-add').click();

        // Save the view
        await page.locator('#mapmenu li.switcher a').click();
        const views = page.locator('lizmap-mapviews');
        await views.locator('.mapviews-name').fill('e2e view');
        await views.locator('.mapviews-submit').click();
        await expect(views.locator('.mapviews-list option', { hasText: 'e2e view' })).toHaveCount(1);

        // Reset, then load the saved view
        await page.locator('lizmap-treeview .tree-arrange-reset').click();
        await expect(titles).toHaveText(['quartiers', 'shop_bakery_pg']);
        await page.reload();
        await page.locator('#layers-arrange').click();
        await views.locator('.mapviews-list').selectOption({ label: 'e2e view' });
        await views.locator('.mapviews-apply').click();
        await expect(titles).toHaveText(['shop_bakery_pg', 'quartiers']);
        await expect(page.getByTestId('ext-catalog-testsrepository~layer_group_visible_only')).toHaveCount(1);

        // Delete the view
        await views.locator('.mapviews-delete').click();
        await expect(views.locator('.mapviews-list option', { hasText: 'e2e view' })).toHaveCount(0);
        await page.locator('lizmap-treeview .tree-arrange-reset').click();
    });
});
