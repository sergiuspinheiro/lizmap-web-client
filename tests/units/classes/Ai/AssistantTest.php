<?php

use Lizmap\Ai\Assistant;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * Assistant whose answers are given by the test, instead of Claude.
 */
class AssistantForTests extends Assistant
{
    public $answer = array();

    public $requests = array();

    protected function ask($system, array $content, array $schema, $effort)
    {
        $this->requests[] = array('system' => $system, 'content' => $content, 'schema' => $schema, 'effort' => $effort);

        return $this->answer;
    }
}

/**
 * @internal
 */
#[CoversNothing]
class AssistantTest extends TestCase
{
    protected function layers(): array
    {
        return array(
            Assistant::layerIndexEntry('montpellier', 'Demo', 'ortho', 'Orthophotos', array(
                'name' => 'ortho_2025', 'title' => 'Orthophoto 2025', 'abstract' => '<b>RGB</b> 2025', 'geometryType' => '',
            ), array('ortho', 'imagery')),
            Assistant::layerIndexEntry('montpellier', 'Demo', 'transport', 'Transport', array(
                'name' => 'tramstop', 'title' => 'Tram stops', 'geometryType' => 'point',
            )),
        );
    }

    public function testConfig(): void
    {
        $assistant = new Assistant(array('enabled' => 'on', 'apiKey' => 'key'));
        $this->assertTrue($assistant->isEnabled());
        $this->assertTrue($assistant->isAllowed(true));
        $this->assertFalse($assistant->isAllowed(false));
        $this->assertTrue($assistant->canAnalyse());
        $this->assertEquals(1000, $assistant->maxFeatures());

        $assistant = new Assistant(array('enabled' => 'off', 'apiKey' => 'key'));
        $this->assertFalse($assistant->isEnabled());

        $assistant = new Assistant(array('enabled' => 'on', 'apiKey' => 'key', 'allowAnonymous' => 'on', 'sendStatistics' => 'off'));
        $this->assertTrue($assistant->isAllowed(false));
        $this->assertFalse($assistant->canAnalyse());
    }

    public function testLayerIndexEntry(): void
    {
        $layers = $this->layers();
        $this->assertEquals('montpellier~ortho~ortho_2025', $layers[0]['id']);
        $this->assertEquals('raster', $layers[0]['type']);
        $this->assertEquals('RGB 2025', $layers[0]['abstract']);
        $this->assertEquals('ortho, imagery', $layers[0]['keywords']);
        $this->assertEquals('point', $layers[1]['type']);
    }

    public function testSearchKeepsOnlyCatalogLayers(): void
    {
        $assistant = new AssistantForTests(array('enabled' => 'on', 'provider' => 'claude', 'apiKey' => 'key'));
        $assistant->answer = array(
            'answer' => 'Uma camada corresponde.',
            'results' => array(
                array('id' => 'montpellier~ortho~ortho_2025', 'reason' => 'Ortofoto de 2025'),
                array('id' => 'secret~project~layer', 'reason' => 'Invented'),
                array('id' => 'montpellier~ortho~ortho_2025', 'reason' => 'Twice'),
                array('reason' => 'No id'),
            ),
        );
        $result = $assistant->search('ortofotos 2025', $this->layers());

        $this->assertEquals('Uma camada corresponde.', $result['answer']);
        $this->assertCount(1, $result['results']);
        $this->assertEquals('ortho', $result['results'][0]['project']);
        $this->assertEquals('ortho_2025', $result['results'][0]['name']);
        $this->assertEquals('Ortofoto de 2025', $result['results'][0]['reason']);

        // The question is sent apart from the catalog, which is cached
        $content = $assistant->requests[0]['content'];
        $this->assertStringContainsString('Tram stops', $content[0]['text']);
        $this->assertArrayHasKey('cacheControl', $content[0]);
        $this->assertStringContainsString('ortofotos 2025', $content[1]['text']);
    }

    public function testAnalyse(): void
    {
        $assistant = new AssistantForTests(array('enabled' => 'on', 'apiKey' => 'key', 'maxFeatures' => 50));
        $assistant->answer = array('answer' => 'Paragens de elétrico.', 'feature' => ' Lapa Furada ', 'highlights' => array(
            'a',
            1,
            array('text' => 'A Lapa Furada', 'feature' => ' Lapa Furada '),
            array('feature' => 'No text'),
        ), 'suggestions' => 'wrong');
        $result = $assistant->analyse($this->layers()[1], array('features' => 3, 'fields' => array()), '', 'pt_PT');

        $this->assertEquals('Paragens de elétrico.', $result['answer']);
        $this->assertEquals('Lapa Furada', $result['feature']);
        $this->assertStringContainsString('never guess', $assistant->requests[0]['system']);
        $this->assertEquals(array(
            array('text' => 'a', 'feature' => ''),
            array('text' => '1', 'feature' => ''),
            array('text' => 'A Lapa Furada', 'feature' => 'Lapa Furada'),
        ), $result['highlights']);
        $this->assertEquals(array(), $result['suggestions']);

        $content = $assistant->requests[0]['content'];
        $this->assertCount(1, $content);
        $input = json_decode(trim(str_replace(array('<layer>', '</layer>'), '', $content[0]['text'])), true);
        $this->assertEquals(50, $input['statistics']['limit']);
        $this->assertEquals('pt_PT', $input['language']);
    }

    public function testProviders(): void
    {
        $content = array(
            array('type' => 'text', 'text' => 'catalog'),
            array('type' => 'text', 'text' => 'question'),
        );
        $schema = array('type' => 'object');

        // The default: a local model, no API key
        $assistant = new Assistant(array('enabled' => 'on'));
        $this->assertEquals('ollama', $assistant->provider());
        $this->assertTrue($assistant->isEnabled());
        $request = $assistant->providerRequest('system', $content, $schema);
        $this->assertEquals('http://localhost:11434/api/chat', $request['url']);
        $this->assertEquals('gemma3:4b', $request['body']['model']);
        $this->assertFalse($request['body']['think']);
        $assistant = new Assistant(array('enabled' => 'on', 'provider' => 'Ollama', 'model' => 'qwen3:14b', 'ollamaUrl' => 'http://host:11434/'));
        $this->assertTrue($assistant->isEnabled());
        $request = $assistant->providerRequest('system', $content, $schema);
        $this->assertEquals('http://host:11434/api/chat', $request['url']);
        $this->assertEquals('qwen3:14b', $request['body']['model']);
        $this->assertFalse($request['body']['stream']);
        $this->assertEquals($schema, $request['body']['format']);
        $this->assertEquals('system', $request['body']['messages'][0]['content']);
        $this->assertEquals("catalog\n\nquestion", $request['body']['messages'][1]['content']);

        // OpenAI and Mistral need a key and a model
        $assistant = new Assistant(array('enabled' => 'on', 'provider' => 'openai', 'model' => 'm'));
        $this->assertFalse($assistant->isEnabled());
        $assistant = new Assistant(array('enabled' => 'on', 'provider' => 'mistral', 'model' => 'mistral-large-latest', 'apiKey' => 'k'));
        $this->assertTrue($assistant->isEnabled());
        $request = $assistant->providerRequest('system', $content, $schema);
        $this->assertEquals('https://api.mistral.ai/v1/chat/completions', $request['url']);
        $this->assertEquals('Bearer k', $request['headers']['Authorization']);
        $this->assertEquals('json_schema', $request['body']['response_format']['type']);
        $this->assertEquals($schema, $request['body']['response_format']['json_schema']['schema']);

        // OpenAI compatible: the URL is required, the key is not
        $assistant = new Assistant(array('enabled' => 'on', 'provider' => 'openai-compatible', 'model' => 'm'));
        $this->assertFalse($assistant->isEnabled());
        $assistant = new Assistant(array('enabled' => 'on', 'provider' => 'openai-compatible', 'model' => 'm', 'url' => 'http://localhost:1234/v1'));
        $this->assertTrue($assistant->isEnabled());
        $request = $assistant->providerRequest('system', $content, $schema);
        $this->assertEquals('http://localhost:1234/v1/chat/completions', $request['url']);
        $this->assertEquals(array(), $request['headers']);

        // Gemini
        $assistant = new Assistant(array('enabled' => 'on', 'provider' => 'gemini', 'model' => 'gemini-pro', 'apiKey' => 'g'));
        $request = $assistant->providerRequest('system', $content, $schema);
        $this->assertEquals('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', $request['url']);
        $this->assertEquals('g', $request['headers']['x-goog-api-key']);
        $this->assertEquals($schema, $request['body']['generationConfig']['responseJsonSchema']);

        // Unknown provider: the default one
        $assistant = new Assistant(array('enabled' => 'on', 'provider' => 'other'));
        $this->assertEquals('ollama', $assistant->provider());

        // Claude: the key is required, the model has a default
        $assistant = new Assistant(array('enabled' => 'on', 'provider' => 'claude'));
        $this->assertFalse($assistant->isEnabled());
        $assistant = new Assistant(array('enabled' => 'on', 'provider' => 'claude', 'apiKey' => 'key'));
        $this->assertTrue($assistant->isEnabled());
    }

    public function testProviderAnswers(): void
    {
        $answers = array(
            'ollama' => array('message' => array('content' => '{"answer":"a","results":[]}')),
            'gemini' => array('candidates' => array(array('content' => array('parts' => array(array('text' => '{"answer":"a",'), array('text' => '"results":[]}')))))),
            'openai' => array('choices' => array(array('message' => array('content' => '{"answer":"a","results":[]}')))),
        );
        foreach ($answers as $provider => $answer) {
            $assistant = new HttpAssistantForTests(array('enabled' => 'on', 'provider' => $provider, 'model' => 'm', 'apiKey' => 'k'));
            $assistant->answer = $answer;
            $result = $assistant->search('q', $this->layers());
            $this->assertEquals('a', $result['answer']);
        }
    }

    public function testClosestLayers(): void
    {
        $layers = array();
        for ($i = 0; $i < 10; ++$i) {
            $layers[] = Assistant::layerIndexEntry('r', 'R', 'p', 'Map', array('name' => 'l'.$i, 'title' => 'Layer '.$i, 'geometryType' => 'point'));
        }
        $layers[] = Assistant::layerIndexEntry('r', 'R', 'p', 'Map', array('name' => 'bus', 'title' => 'Paragens de autocarro', 'abstract' => 'Rede de transportes'));
        $layers[] = Assistant::layerIndexEntry('r', 'R', 'p', 'Map', array('name' => 'ortho', 'title' => 'Ortofotomapa 2025'));

        $this->assertCount(12, Assistant::closestLayers('x', $layers, 20));
        $closest = Assistant::closestLayers('Transporte público', $layers, 3);
        $this->assertCount(3, $closest);
        $this->assertEquals('bus', $closest[0]['name']);
        $this->assertEquals('l0', $closest[1]['name']);
        $closest = Assistant::closestLayers('ortofotos', $layers, 1);
        $this->assertEquals('ortho', $closest[0]['name']);
    }

    public function testLocalSearchUsesShortIds(): void
    {
        $assistant = new AssistantForTests(array('enabled' => 'on', 'provider' => 'ollama'));
        $assistant->answer = array(
            'answer' => 'Ortofoto.',
            'results' => array(array('id' => 1, 'reason' => 'Imagem 2025'), array('id' => '9', 'reason' => 'Invented')),
        );
        $result = $assistant->search('ortofoto', $this->layers());
        $this->assertCount(1, $result['results']);
        $this->assertEquals('montpellier~ortho~ortho_2025', $result['results'][0]['id']);
        $catalog = $assistant->requests[0]['content'][0]['text'];
        $this->assertStringContainsString('1 | Orthophoto 2025 | Orthophotos | raster', $catalog);
        $this->assertStringContainsString('2 | Tram stops | Transport | point', $catalog);
    }
    public function testSearchFallsBackOnWords(): void
    {
        $assistant = new AssistantForTests(array('enabled' => 'on', 'provider' => 'ollama'));
        $assistant->answer = array('answer' => 'No layer matches the request because it is too generic.', 'results' => array());
        $result = $assistant->search('Transports', $this->layers(), 'pt_PT');
        $this->assertTrue($result['keywords']);
        $this->assertEquals('', $result['answer']);
        $this->assertCount(1, $result['results']);
        $this->assertEquals('tramstop', $result['results'][0]['name']);
        // The interface language is given to the assistant
        $this->assertStringContainsString('language: pt_PT', $assistant->requests[0]['content'][1]['text']);
        $this->assertStringContainsString('theme', $assistant->requests[0]['system']);

        // No word in common: nothing
        $result = $assistant->search('xyzzy', $this->layers());
        $this->assertFalse($result['keywords']);
        $this->assertCount(0, $result['results']);
        $this->assertEquals('No layer matches the request because it is too generic.', $result['answer']);
    }
    public function testSearchWithDocuments(): void
    {
        $this->assertEquals(
            'Condicionantes à construção, PDM: Definição',
            Assistant::closestText('Onde posso construir?', 'PDM: Definição, Condicionantes à construção, Rede elétrica', 45),
        );
        $layers = $this->layers();
        $layers[] = Assistant::layerIndexEntry('obidos', 'Óbidos', 'pdm', 'PDM', array('name' => 'ordenamento', 'title' => 'Ordenamento', 'geometryType' => 'polygon'))
            + array('documents' => 'PDM de Óbidos: Definição, Condicionantes à construção');
        $scores = Assistant::keywordScores('Onde posso construir no Pinhal', $layers);
        $this->assertEquals(array(0, 0, 1), array_values($scores));

        $assistant = new AssistantForTests(array('enabled' => 'on', 'provider' => 'ollama'));
        $assistant->answer = array('answer' => '', 'results' => array(array('id' => '1', 'reason' => 'Regulamento')));
        $result = $assistant->search('Onde posso construir?', $layers);
        $this->assertEquals('ordenamento', $result['results'][0]['name']);
        // The layer sharing words with the question first
        $this->assertStringContainsString('1 | Ordenamento | PDM | polygon |  | docs: Condicionantes à construção', $assistant->requests[0]['content'][0]['text']);
    }

    public function testLocalSearchCatalogLength(): void
    {
        $layers = array();
        for ($i = 0; $i < 30; ++$i) {
            $layers[] = Assistant::layerIndexEntry('r', 'R', 'p', 'Map', array('name' => 'l'.$i, 'title' => 'Layer '.$i, 'abstract' => str_repeat('Some words. ', 20)))
                + array('documents' => 'PDM: '.str_repeat('Artigo sobre outra coisa, ', 20));
        }
        $layers[] = Assistant::layerIndexEntry('r', 'R', 'p', 'Map', array('name' => 'pinhal', 'title' => 'Pinhal'));
        $assistant = new AssistantForTests(array('enabled' => 'on', 'provider' => 'ollama'));
        $assistant->answer = array('answer' => '', 'results' => array(array('id' => '1', 'reason' => 'Pinhal')));
        $result = $assistant->search('Posso construir no pinhal?', $layers);
        $this->assertEquals('pinhal', $result['results'][0]['name']);
        $catalog = $assistant->requests[0]['content'][0]['text'];
        // The closest layer first, and a short catalog
        $this->assertStringContainsString("<catalog>\n1 | Pinhal |", $catalog);
        $this->assertTrue(mb_strlen($catalog) <= Assistant::MAX_LOCAL_CATALOG_LENGTH + 30);
        $this->assertTrue(substr_count($catalog, "\n") >= 4);
    }

    public function testAnalysisBudget(): void
    {
        $this->assertEquals(array('features' => 12000, 'documents' => 30000), (new Assistant(array('provider' => 'gemini')))->analysisBudget(false));
        $local = new Assistant(array('provider' => 'ollama'));
        $this->assertEquals(8192, $local->contextLength());
        $this->assertEquals(array('features' => 4000, 'documents' => 4000), $local->analysisBudget(true));
        $this->assertEquals(8000, $local->analysisBudget(false)['features']);
        $small = new Assistant(array('provider' => 'ollama', 'contextLength' => '4096'));
        $this->assertEquals(array('features' => 7788, 'documents' => 3894), $small->analysisBudget(false));
        $this->assertEquals(3894, $small->analysisBudget(true)['features']);
        $this->assertEquals(2048, (new Assistant(array('contextLength' => '100')))->contextLength());
    }

    public function testAnalyseWithFeatures(): void
    {
        $assistant = new AssistantForTests(array('enabled' => 'on', 'provider' => 'ollama'));
        $this->assertTrue($assistant->canSendFeatures());
        $this->assertEquals(100, $assistant->maxRows());
        $this->assertFalse((new Assistant(array('provider' => 'gemini')))->canSendFeatures());
        $this->assertTrue((new Assistant(array('provider' => 'gemini', 'sendFeatures' => 'on')))->canSendFeatures());
        $this->assertFalse((new Assistant(array('provider' => 'ollama', 'sendFeatures' => 'off')))->canSendFeatures());

        $assistant->answer = array('answer' => 'Fica em -8.5, 39.5.', 'feature' => 'Lapa Furada', 'highlights' => array(), 'suggestions' => array());
        $sample = array('table' => "nome | lon | lat\nLapa Furada | -8.5 | 39.5", 'rows' => 1, 'matched' => 1, 'read' => 6);
        $assistant->analyse($this->layers()[1], null, 'onde fica a lapa furada', 'pt_PT', $sample);
        $content = $assistant->requests[0]['content'];
        $this->assertCount(3, $content);
        $this->assertStringContainsString('<features read="6" rows="1" matching_question="1">', $content[1]['text']);
        $this->assertStringContainsString('Lapa Furada | -8.5 | 39.5', $content[1]['text']);
        $this->assertStringContainsString('onde fica', $content[2]['text']);
    }
}

/**
 * Assistant whose HTTP answers are given by the test.
 */
class HttpAssistantForTests extends Assistant
{
    public $answer = array();

    protected function postJson($url, array $headers, array $body)
    {
        return $this->answer;
    }
}
