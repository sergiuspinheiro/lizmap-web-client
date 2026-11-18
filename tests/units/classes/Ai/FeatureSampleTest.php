<?php

use Lizmap\Ai\FeatureSample;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class FeatureSampleTest extends TestCase
{
    protected function features(): array
    {
        $features = array();
        for ($i = 1; $i <= 5; ++$i) {
            $features[] = array('properties' => array('nome' => 'Gruta '.$i, 'tipo' => 'gruta'), 'geometry' => array('type' => 'Point', 'coordinates' => array(-9.1 - $i / 100, 39.2)));
        }
        $features[] = (object) array('properties' => (object) array('nome' => 'Gruta do Moleiro - Lapa Furada', 'tipo' => 'lapa | abrigo'), 'geometry' => (object) array(
            'type' => 'Polygon', 'coordinates' => array(array(array(-9.0, 39.0), array(-8.0, 39.0), array(-8.0, 40.0), array(-9.0, 39.0))),
        ));

        return $features;
    }

    public function testMatchingFeaturesFirst(): void
    {
        $sample = new FeatureSample('Onde fica a Lapa Furada?', 3);
        $sample->addFeatures($this->features());
        $result = $sample->toArray();
        $this->assertEquals(6, $result['read']);
        $this->assertEquals(1, $result['matched']);
        $this->assertEquals(3, $result['rows']);
        $this->assertEquals(array('nome', 'tipo', 'lon', 'lat'), $result['columns']);
        $lines = explode("\n", $result['table']);
        $this->assertEquals('nome | tipo | lon | lat', $lines[0]);
        // The separator is not in the values; the position is the center of the extent
        $this->assertEquals('Gruta do Moleiro - Lapa Furada | lapa / abrigo | -8.5 | 39.5', $lines[1]);
        $this->assertEquals('Gruta 1 | gruta | -9.11 | 39.2', $lines[2]);
        $this->assertCount(4, $lines);
    }

    public function testLimits(): void
    {
        $sample = new FeatureSample('', 100, 60, 10);
        $sample->addFeatures($this->features(), 4);
        $result = $sample->toArray();
        $this->assertEquals(4, $result['read']);
        $this->assertEquals(0, $result['matched']);
        // The table is cut to its maximum length
        $this->assertEquals(1, $result['rows']);
        $this->assertTrue(mb_strlen($result['table']) <= 60);

        $sample = new FeatureSample('x');
        $this->assertEquals('', $sample->toArray()['table']);
    }
}
