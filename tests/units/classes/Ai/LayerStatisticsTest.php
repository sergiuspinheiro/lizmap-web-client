<?php

use Lizmap\Ai\LayerStatistics;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class LayerStatisticsTest extends TestCase
{
    public function testNumbersAndTexts(): void
    {
        $stats = new LayerStatistics(2, 60, 2);
        $stats->addFeatures(array(
            array('type' => 'Feature', 'properties' => array('area' => 10, 'kind' => 'forest', 'owner' => 'Ana')),
            array('type' => 'Feature', 'properties' => array('area' => 30.5, 'kind' => 'forest', 'owner' => 'Rui')),
            (object) array('type' => 'Feature', 'properties' => (object) array('area' => null, 'kind' => 'urban', 'owner' => '')),
            array('type' => 'Feature', 'properties' => array('area' => 2, 'kind' => 'urban', 'owner' => 'Eva')),
        ));
        $data = $stats->toArray();

        $this->assertEquals(4, $data['features']);
        $fields = array_column($data['fields'], null, 'name');

        $this->assertEquals('number', $fields['area']['type']);
        $this->assertEquals(3, $fields['area']['filled']);
        $this->assertEquals(1, $fields['area']['empty']);
        $this->assertEquals(2, $fields['area']['min']);
        $this->assertEquals(30.5, $fields['area']['max']);
        $this->assertEquals(14.1667, $fields['area']['mean']);

        $this->assertEquals('text', $fields['kind']['type']);
        $this->assertEquals(2, $fields['kind']['distinct']);
        $this->assertCount(2, $fields['kind']['top']);
        $this->assertEquals(2, $fields['kind']['top'][0]['count']);

        // Values of a single feature are never sent
        $this->assertEquals(3, $fields['owner']['distinct']);
        $this->assertEquals(array(), $fields['owner']['top']);
    }

    public function testLimitAndLongValues(): void
    {
        $stats = new LayerStatistics(5, 5, 1);
        $features = array();
        for ($i = 0; $i < 10; ++$i) {
            $features[] = array('properties' => array('name' => 'abcdefghij'));
        }
        $stats->addFeatures($features, 3);
        $data = $stats->toArray();

        $this->assertEquals(3, $data['features']);
        $this->assertEquals('abcde…', $data['fields'][0]['top'][0]['value']);
    }
}
