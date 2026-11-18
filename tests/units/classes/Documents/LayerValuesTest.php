<?php

use Lizmap\Documents\LayerValues;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 *
 * @coversNothing
 */
class LayerValuesTest extends TestCase
{
    public function testFieldsAndValues()
    {
        $values = new LayerValues(3, 10);
        $values->addFeatures(array(
            array('properties' => array('classe' => 'Espaço 10', 'area' => 12, 'note' => null)),
            array('properties' => array('classe' => 'Espaço 2', 'area' => 12, 'note' => 'a very long text')),
            (object) array('properties' => (object) array('classe' => 'espaço 1', 'area' => 3, 'flag' => true)),
            array('properties' => array('classe' => 'Outro', 'area' => 4)),
            array('properties' => array('classe' => 'Espaço 2', 'area' => 4)),
        ));
        $data = $values->toArray();
        $this->assertEquals(5, $data['read']);
        $fields = array_column($data['fields'], null, 'name');
        $this->assertEquals(array('classe', 'area', 'note', 'flag'), array_keys($fields));
        // Natural order, at most 3 distinct values
        $this->assertEquals(array('espaço 1', 'Espaço 2', 'Espaço 10'), $fields['classe']['values']);
        $this->assertTrue($fields['classe']['truncated']);
        $this->assertEquals(array('3', '4', '12'), $fields['area']['values']);
        $this->assertFalse($fields['area']['truncated']);
        // Too long, null and boolean values are not kept
        $this->assertEquals(array(), $fields['note']['values']);
        $this->assertEquals(array(), $fields['flag']['values']);
    }

    public function testLimit()
    {
        $values = new LayerValues();
        $values->addFeatures(array_fill(0, 10, array('properties' => array('a' => 'x'))), 4);
        $this->assertEquals(4, $values->toArray()['read']);
    }
}
