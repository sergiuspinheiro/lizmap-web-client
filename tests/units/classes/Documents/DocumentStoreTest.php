<?php

use Lizmap\Documents\DocumentContext;
use Lizmap\Documents\DocumentStore;
use Lizmap\Documents\SectionParser;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class DocumentStoreTest extends TestCase
{
    protected $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/lizmap-documents-'.bin2hex(random_bytes(4)).'/';
    }

    protected function tearDown(): void
    {
        foreach (array_merge(glob($this->dir.'*/*') ?: array(), glob($this->dir.'*') ?: array()) as $path) {
            is_dir($path) ? @rmdir($path) : @unlink($path);
        }
        @rmdir($this->dir);
    }

    protected function file($content): string
    {
        $path = tempnam(sys_get_temp_dir(), 'doc');
        file_put_contents($path, $content);

        return $path;
    }

    public function testSections(): void
    {
        $sections = SectionParser::parse("# Gruta do Moleiro\nAbrigo com ocupação neolítica.\nEscavada em 1990.\n\nEspólio\nCerâmica e líticos.", 1500);
        $this->assertCount(2, $sections);
        $this->assertEquals('Gruta do Moleiro', $sections[0]['title']);
        $this->assertEquals("Abrigo com ocupação neolítica.\nEscavada em 1990.", $sections[0]['text']);
        $this->assertEquals('§2', $sections[1]['label']);
        $this->assertEquals('Espólio', $sections[1]['title']);

        $long = SectionParser::parse(str_repeat("Uma frase com algumas palavras.\n", 100), 500);
        $this->assertTrue(count($long) >= 6);
    }

    public function testRegulationAndLinks(): void
    {
        $store = new DocumentStore($this->dir);
        $id = $store->saveCollection(array('title' => 'PDM de Óbidos', 'type' => 'regulation'));
        $this->assertEquals('pdm-de-obidos', $id);

        $store->addDocument($id, $this->file("Artigo 67.º-A\nDefinição\nÁreas de edificação dispersa.\nArtigo 67.º-B\nCondicionantes\na) ATC máxima de 400 m²;"), 'pdm.txt', 'PDM 2013', '2013-06-18');
        $store->addDocument($id, $this->file("Artigo 67.º-B\nCondicionantes\na) ATC máxima de 500 m²;\nb) [...]"), 'alteracao.md', 'Alteração 2019', '2019-10-15');
        $collection = $store->collection($id);
        $this->assertCount(2, $collection['documents']);
        $this->assertEquals('articles', $collection['documents'][0]['kind']);
        $this->assertTrue(is_file($store->documentFile($id, $collection['documents'][1])));

        $parts = $store->parts($id);
        $this->assertEquals(array('67-A', '67-B'), array_keys($parts));
        $this->assertStringContainsString('500 m²', $parts['67-B']['text']);
        $this->assertStringContainsString('400 m²', $parts['67-B']['previous']['text']);
        $this->assertStringContainsString('400 m²', $store->parts($id, '2015-01-01')['67-B']['text']);

        // Correct a part
        $this->assertTrue($store->updateDocument($id, 'pdm-2013', array('title' => 'Definição', 'text' => 'Áreas edificadas dispersas.'), '67-A'));
        $this->assertEquals('Áreas edificadas dispersas.', $store->parts($id)['67-A']['text']);

        // Links: one for a class, one for the whole layer
        $store->addLink(array('collection' => $id, 'repository' => 'r', 'project' => 'p', 'layer' => 'ordenamento',
            'field' => 'classe', 'value' => 'Edificação dispersa', 'parts' => '67.º-A, 67-B', 'note' => 'Planta de ordenamento'));
        $other = $store->saveCollection(array('title' => 'Fichas', 'type' => 'documents'));
        $store->addDocument($other, $this->file("Gruta do Moleiro\nAbrigo com ocupação neolítica."), 'fichas.txt', '', '2020-01-01');
        $store->addLink(array('collection' => $other, 'repository' => 'r', 'project' => 'p', 'layer' => 'grutas'));
        $this->assertCount(1, $store->linksOf('r', 'p', 'ordenamento'));
        $this->assertEquals(array('67-A', '67-B'), $store->links()[0]['parts']);

        $context = new DocumentContext($store);
        // The value is not in the features nor in the question
        $result = $context->forLayer('r', 'p', 'ordenamento', 'Que regras?', array(array('classe' => 'Espaço urbano')));
        $this->assertEquals('', $result['text']);
        // The value is in the features
        $result = $context->forLayer('r', 'p', 'ordenamento', 'Que regras?', array(array('classe' => 'edificação  dispersa')));
        $this->assertStringContainsString('PDM de Óbidos — Artigo 67.º-B — Condicionantes (Alteração 2019, 2019-10-15)', $result['text']);
        $this->assertStringContainsString('(aplica-se a classe = Edificação dispersa)', $result['text']);
        $this->assertStringContainsString('(nota: Planta de ordenamento)', $result['text']);
        $this->assertStringContainsString('texto anterior mantido', $result['text']);
        $this->assertCount(2, $result['sources']);
        // The value is in the question
        $result = $context->forLayer('r', 'p', 'ordenamento', 'O que posso construir em edificação dispersa?', null);
        $this->assertCount(2, $result['sources']);
        // Other documents: all the sections of the layer
        $result = $context->forLayer('r', 'p', 'grutas', 'Lapa Furada', null, 8000);
        $this->assertStringContainsString('Abrigo com ocupação neolítica.', $result['text']);
        $this->assertEquals('Fichas', $result['sources'][0]['collection']);

        // Limit of length
        $result = $context->forLayer('r', 'p', 'ordenamento', 'edificação dispersa', null, 60);
        $this->assertCount(1, $result['sources']);

        // Correct a link: same id, same place
        $linkId = $store->links()[0]['id'];
        $store->addLink(array('id' => $linkId, 'collection' => $id, 'repository' => 'r', 'project' => 'p', 'layer' => 'ordenamento',
            'field' => 'classe', 'value' => 'Espaço urbano', 'parts' => array('67-A')));
        $this->assertCount(2, $store->links());
        $this->assertEquals($linkId, $store->links()[0]['id']);
        $this->assertEquals('Espaço urbano', $store->links()[0]['value']);
        $this->assertEquals(array('67-A'), $store->links()[0]['parts']);
        // A link of another collection is not replaced
        try {
            $store->addLink(array('id' => $store->links()[1]['id'], 'collection' => $id, 'repository' => 'r', 'project' => 'p'));
            $this->fail('A link of another collection was replaced');
        } catch (\RuntimeException $e) {
            $this->assertEquals('Unknown link', $e->getMessage());
        }

        $store->deleteLink($store->links()[0]['id']);
        $this->assertCount(0, $store->linksOf('r', 'p', 'ordenamento'));
        $store->deleteCollection($id);
        $this->assertNull($store->collection($id));
        $this->assertFalse(is_file($this->dir.$id.'.json'));
    }
}
