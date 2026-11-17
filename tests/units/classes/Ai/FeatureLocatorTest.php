<?php

use Lizmap\Ai\FeatureLocator;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class FeatureLocatorTest extends TestCase
{
    protected function features(): array
    {
        return array(
            array('properties' => array('nome' => 'Lapa Furada', 'id' => 1), 'geometry' => array('type' => 'Point', 'coordinates' => array(-9.3, 39.2))),
            array('properties' => array('nome' => 'Gruta da Lapa Furada II', 'id' => 2), 'geometry' => array('type' => 'Point', 'coordinates' => array(-9.1, 39.4))),
            array('properties' => array('nome' => 'Outra gruta', 'id' => 3), 'geometry' => array('type' => 'Point', 'coordinates' => array(-8.0, 38.0))),
            array('properties' => array('nome' => 'Lapa furada'), 'geometry' => null),
            (object) array('properties' => (object) array('freguesia' => 'Mateus'), 'geometry' => (object) array(
                'type' => 'Polygon', 'coordinates' => array(array(array(-9.5, 39.0), array(-9.2, 39.0), array(-9.2, 39.3), array(-9.5, 39.0))),
            )),
        );
    }

    public function testExactValueFirst(): void
    {
        $locator = new FeatureLocator('LAPA  furada');
        $locator->addFeatures($this->features());
        $result = $locator->toArray();
        $this->assertEquals(1, $result['count']);
        $this->assertTrue($result['exact']);
        $this->assertEquals(array(-9.3, 39.2, -9.3, 39.2), $result['extent']);
        $this->assertEquals(5, $result['read']);
    }

    public function testPartialValueAndPolygon(): void
    {
        $locator = new FeatureLocator('Furada II');
        $locator->addFeatures($this->features());
        $result = $locator->toArray();
        $this->assertEquals(1, $result['count']);
        $this->assertFalse($result['exact']);
        $this->assertEquals(array(-9.1, 39.4, -9.1, 39.4), $result['extent']);

        $locator = new FeatureLocator('mateus');
        $locator->addFeatures($this->features());
        $this->assertEquals(array(-9.5, 39.0, -9.2, 39.3), $locator->toArray()['extent']);
    }

    public function testNothingFound(): void
    {
        $locator = new FeatureLocator('Peniche');
        $locator->addFeatures($this->features(), 2);
        $result = $locator->toArray();
        $this->assertEquals(0, $result['count']);
        $this->assertNull($result['extent']);
        $this->assertEquals(2, $result['read']);
        // An empty value finds nothing
        $locator = new FeatureLocator(' ');
        $locator->addFeatures($this->features());
        $this->assertEquals(0, $locator->toArray()['count']);
    }
}
