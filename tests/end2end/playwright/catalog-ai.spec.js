// @ts-check
import { test, expect } from '@playwright/test';
import { ProjectPage } from './pages/project';

test.describe('AI assistant @readonly', () => {
    test('Without configuration, the assistant has no dock', async ({ page }) => {
        const project = new ProjectPage(page, 'base_layers');
        await project.open();
        await expect(page.locator('#mapmenu li.catalog')).toHaveCount(1);
        await expect(page.locator('#mapmenu li.assistant')).toHaveCount(0);
    });

    test('Without configuration, the assistant is off @requests', async ({ request }) => {
        const status = await request.get('/index.php/lizmap/catalog/assistant');
        expect(status.status()).toBe(200);
        expect((await status.json()).enabled).toBe(false);

        const search = await request.post('/index.php/lizmap/catalog/search', { form: { q: 'test' } });
        expect(search.status()).toBe(404);
    });
});
