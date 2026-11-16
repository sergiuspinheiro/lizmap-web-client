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
        $assistant = new AssistantForTests(array('enabled' => 'on', 'apiKey' => 'key'));
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
        $assistant->answer = array('answer' => 'Paragens de elétrico.', 'highlights' => array('a', 1), 'suggestions' => 'wrong');
        $result = $assistant->analyse($this->layers()[1], array('features' => 3, 'fields' => array()), '', 'pt_PT');

        $this->assertEquals('Paragens de elétrico.', $result['answer']);
        $this->assertEquals(array('a', '1'), $result['highlights']);
        $this->assertEquals(array(), $result['suggestions']);

        $content = $assistant->requests[0]['content'];
        $this->assertCount(1, $content);
        $input = json_decode(trim(str_replace(array('<layer>', '</layer>'), '', $content[0]['text'])), true);
        $this->assertEquals(50, $input['statistics']['limit']);
        $this->assertEquals('pt_PT', $input['language']);
    }
}
