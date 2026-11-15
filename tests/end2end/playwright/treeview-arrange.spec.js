// @ts-check
import { test, expect } from '@playwright/test';
import { ProjectPage } from './pages/project';

test.describe('Treeview arrangement @readonly', () => {
    test('Reorder layers and change icons, kept in the browser', async ({ page }) => {
        const project = new ProjectPage(page, 'treeview');
        await project.open();

        const group = page.getByTestId('group with space in name and shortname defined');
        const titles = group.locator(':scope > ul > li .node > label');
        await expect(titles).toHaveText(['quartiers', 'shop_bakery_pg']);

        // Out of arrange mode the items are not draggable
        await expect(page.getByTestId('quartiers')).toHaveAttribute('draggable', 'false');

        await page.locator('#layers-arrange').click();
        await expect(page.locator('lizmap-treeview .tree-arrange-bar')).toBeVisible();

        // Move shop_bakery_pg above quartiers
        await page.getByTestId('shop_bakery_pg').dragTo(page.getByTestId('quartiers'), {
            targetPosition: { x: 20, y: 2 },
        });
        await expect(titles).toHaveText(['shop_bakery_pg', 'quartiers']);

        // Change the icon of the group
        await group.locator(':scope > div .tree-icon-button').click();
        await group.locator('.tree-icon-picker .tree-icon-preset').first().click();
        await expect(group.locator(':scope > div .node > img.legend')).toHaveAttribute('src', /^data:image\/svg\+xml/);

        // The arrangement is kept after a reload
        await page.reload();
        await expect(titles).toHaveText(['shop_bakery_pg', 'quartiers']);
        await expect(group.locator(':scope > div .node > img.legend')).toHaveCount(1);

        // Restore the project tree
        await page.locator('#layers-arrange').click();
        await page.locator('lizmap-treeview .tree-arrange-reset').click();
        await expect(titles).toHaveText(['quartiers', 'shop_bakery_pg']);
        await expect(group.locator(':scope > div .node > img.legend')).toHaveCount(0);
    });
});
