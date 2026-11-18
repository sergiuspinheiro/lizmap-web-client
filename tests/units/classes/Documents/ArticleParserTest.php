<?php

use Lizmap\Documents\ArticleParser;
use Lizmap\Documents\PdfText;
use Lizmap\Documents\Regulation;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class ArticleParserTest extends TestCase
{
    protected function original(): string
    {
        return <<<'EOT'
Diário da República, 2.ª série — N.º 114 — 17 de junho de 2013
CAPÍTULO III
Ordenamento
SECÇÃO X
Disposições sobre áreas de edificação dispersa
Artigo 67.º -A
Definição
Estas áreas correspondem a áreas edificadas dispersas.
Artigo 67.º -B
Condicionantes à construção
1 — É permitida a edificação nas seguintes condições:
a) A área total da construção (ATC) máxima seja de 400 m²;
b) A cércea máxima seja de dois pisos, 6 metros;
19337
c) Sistemas autó-
nomos e depósitos de ferro -velho.
Artigo 64.º
Apoio a remo
1 — Texto antigo.
É revogado o artigo 64.º do Regulamento do PDM.
307013225
MUNICÍPIO DE LEIRIA
Artigo 1.º
Outro regulamento
EOT;
    }

    public function testParse(): void
    {
        $result = ArticleParser::parse($this->original());
        $this->assertCount(3, $result['articles']);
        $this->assertEquals(array('64'), $result['revoked']);
        list($a, $b, $c) = $result['articles'];
        $this->assertEquals('67-A', $a['number']);
        $this->assertEquals('67.º-A', $a['label']);
        $this->assertEquals('Definição', $a['title']);
        $this->assertEquals('Capítulo III — Ordenamento', $a['chapter']);
        $this->assertEquals('Secção X — Disposições sobre áreas de edificação dispersa', $a['section']);
        $this->assertEquals('Condicionantes à construção', $b['title']);
        $this->assertStringContainsString('a) A área total da construção (ATC) máxima seja de 400 m²;', $b['text']);
        $this->assertStringContainsString('c) Sistemas autónomos e depósitos de ferro-velho.', $b['text']);
        $this->assertFalse(str_contains($b['text'], '19337'));
        // The sentence revoking an article and the next publication are not in the text
        $this->assertEquals('1 — Texto antigo.', $c['text']);
    }

    public function testNumbers(): void
    {
        $this->assertEquals('67-B', ArticleParser::normalizeNumber('67.º-B'));
        $this->assertEquals('23', ArticleParser::normalizeNumber('23.o'));
        $this->assertEquals('24-C', ArticleParser::normalizeNumber(' 24.º -C'));
        $this->assertEquals('24.º-C', ArticleParser::label('24-C'));
        $this->assertEquals(array('12', '13-A'), ArticleParser::revoked('São revogados os artigos 12.º e 13.º-A do Regulamento.'));
    }

    public function testRegulationInForce(): void
    {
        $original = ArticleParser::parse($this->original());
        $amendment = ArticleParser::parse("Artigo 67.º-B\nCondicionantes à construção\n1 — [...]\na) A área total da construção (ATC) máxima seja de 500 m²;\nArtigo 67.º-I\nNovo\nTexto novo.");
        $regulation = new Regulation(array(
            array('id' => 'b', 'title' => 'Alteração', 'date' => '2019-10-15') + $amendment,
            array('id' => 'a', 'title' => 'PDM', 'date' => '2013-06-18') + $original,
        ));

        $inForce = $regulation->inForce();
        $this->assertEquals(array('64', '67-A', '67-B', '67-I'), array_keys($inForce));
        $this->assertTrue($inForce['64']['revoked']);
        $this->assertEquals('b', $inForce['67-B']['document']['id']);
        $this->assertEquals('a', $inForce['67-B']['previous']['document']['id']);
        $this->assertEquals('a', $inForce['67-A']['document']['id']);

        // Before the amendment
        $before = $regulation->inForce('2015-01-01');
        $this->assertCount(3, $before);
        $this->assertNull($before['67-B']['previous']);

        $text = $regulation->text(array('67.º-B', '64', '99'));
        $this->assertStringContainsString('Artigo 67.º-B — Condicionantes à construção (Alteração, 2019-10-15)', $text);
        $this->assertStringContainsString('500 m²', $text);
        $this->assertStringContainsString('texto anterior mantido (PDM, 2013-06-18)', $text);
        $this->assertStringContainsString('400 m²', $text);
        $this->assertStringContainsString("Artigo 64.º — Apoio a remo (PDM, 2013-06-18)\nRevogado.", $text);
    }

    public function testPdfColumns(): void
    {
        $line = static function ($text) {
            $words = '';
            foreach (explode(' ', $text) as $word) {
                $words .= '<word>'.$word.'</word>';
            }

            return '<line>'.$words.'</line>';
        };
        $block = static function ($x0, $y0, $x1, array $lines) use ($line) {
            return '<block xMin="'.$x0.'" yMin="'.$y0.'" xMax="'.$x1.'" yMax="'.($y0 + 10).'">'.implode('', array_map($line, $lines)).'</block>';
        };
        $xhtml = '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><doc><page width="600" height="800"><flow>'
            .$block(300, 100, 550, array('right 1', 'right 2'))
            .$block(50, 50, 550, array('header'))
            .$block(50, 100, 290, array('left 1', 'left 2'))
            .$block(50, 300, 290, array('left 3'))
            .'</flow></page></doc></body></html>';
        $this->assertEquals("header\nleft 1\nleft 2\nleft 3\nright 1\nright 2", PdfText::fromBboxLayout($xhtml));
    }
}
