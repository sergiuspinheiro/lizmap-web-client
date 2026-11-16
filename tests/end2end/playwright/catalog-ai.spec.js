// @ts-check
import { test, expect } from '@playwright/test';
import { ProjectPage } from './pages/project';

test.describe('Data catalog AI assistant @readonly', () => {
    test('Search in natural language and analyse a layer, with a mocked assistant', async ({ page }) => {
        // The assistant answers are mocked: the tests do not call the Anthropic API
        await page.route('**/catalog/assistant*', route => route.fulfill({
            json: { enabled: true, analysis: true },
        }));
        await page.route('**/catalog/search*', route => {
            expect(route.request().method()).toBe('POST');
            expect(route.request().postData()).toContain('q=bairros');
            return route.fulfill({
                json: {
                    answer: 'Encontrei uma camada com os bairros.',
                    results: [{
                        id: 'testsrepository~layer_group_visible_only~quartiers',
                        repository: 'testsrepository',
                        project: 'layer_group_visible_only',
                        name: 'quartiers',
                        title: 'quartiers',
                        map: 'Layer_group_visible_only',
                        reason: 'Limites dos bairros',
                    }],
                },
            });
        });
        await page.route('**/catalog/analyse*', route => route.fulfill({
            json: {
                answer: 'Polígonos dos bairros.',
                highlights: ['7 bairros'],
                suggestions: ['Filtrar por nome'],
                statistics: { features: 7, fields: [] },
            },
        }));

        const project = new ProjectPage(page, 'base_layers');
        await project.open();
        await page.locator('#mapmenu li.catalog a').click();
        const catalog = page.locator('lizmap-catalog');
        const assistant = catalog.locator('details.catalog-ai');
        await expect(assistant).toBeVisible();

        await assistant.locator('summary').click();
        await assistant.locator('.catalog-ai-question').fill('bairros');
        await assistant.locator('.catalog-ai-search').click();
        await expect(assistant.locator('p.catalog-ai-answer')).toHaveText('Encontrei uma camada com os bairros.');
        const result = assistant.locator('.catalog-ai-result');
        await expect(result).toHaveCount(1);
        await expect(result.locator('.catalog-ai-reason')).toHaveText('Limites dos bairros');

        // Add the result to the map
        await result.locator('.catalog-add').click();
        await expect(result).toHaveClass(/added/);
        await expect(page.getByTestId('ext-catalog-testsrepository~layer_group_visible_only')).toHaveCount(1);

        // Analyse it from its preview
        await result.locator('.catalog-preview').click();
        await result.locator('.catalog-ai-analyse').click();
        const analysis = result.locator('.catalog-ai-analysis .catalog-ai-answer');
        await expect(analysis).toContainText('Polígonos dos bairros.');
        await expect(analysis).toContainText('7 bairros');
        await expect(analysis).toContainText('Filtrar por nome');
    });

    test('The assistant is off without configuration @requests', async ({ request }) => {
        const status = await request.get('/index.php/lizmap/catalog/assistant');
        expect(status.status()).toBe(200);
        expect((await status.json()).enabled).toBe(false);

        const search = await request.post('/index.php/lizmap/catalog/search', { form: { q: 'test' } });
        expect(search.status()).toBe(404);
    });
});
