<?php

use Lizmap\Request\OverlayRequest;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 *
 * @coversNothing
 */
class OverlayRequestTest extends TestCase
{
    public function testMeasures()
    {
        // A polygon: area and share of the area analysed
        $feature = OverlayRequest::measures(array('classe' => 'Espaços agrícolas'), 2416.1349, 0, 2954.68, array(1, 2, 3, 4));
        $this->assertEquals(2416.13, $feature['area']);
        $this->assertEquals(81.77, $feature['percent']);
        $this->assertNull($feature['length']);
        $this->assertEquals(array(1, 2, 3, 4), $feature['extent']);
        // A line: its length
        $feature = OverlayRequest::measures(array(), 0, 12.345, 2954.68, null);
        $this->assertNull($feature['area']);
        $this->assertNull($feature['percent']);
        $this->assertEquals(12.35, $feature['length']);
        // The area analysed is a point: no share
        $feature = OverlayRequest::measures(array(), 10, 0, 0, null);
        $this->assertNull($feature['percent']);
        // Rounding errors: never more than 100 %
        $this->assertEquals(100, OverlayRequest::measures(array(), 100.001, 0, 100, null)['percent']);
    }

    public function testAreaSql()
    {
        $cnx = new class {
            public $sql = '';

            public function quote($text)
            {
                return "'".str_replace("'", "''", $text)."'";
            }

            public function query($sql)
            {
                $this->sql = $sql;

                return new class {
                    public function fetch()
                    {
                        return (object) array('geojson' => '{"type":"Polygon"}', 'area' => '12.5', 'xmin' => 1, 'ymin' => 2, 'xmax' => 3, 'ymax' => 4);
                    }
                };
            }
        };
        $area = OverlayRequest::area($cnx, array(array('type' => 'Point', 'coordinates' => array(-9.2, 39.3)), array('type' => 'Point', 'coordinates' => array(0, "1'"))), 10);
        $this->assertEquals(12.5, $area['area']);
        $this->assertEquals(array(1.0, 2.0, 3.0, 4.0), $area['extent']);
        $this->assertStringContainsString('ST_Buffer(g::geography, 10)', $cnx->sql);
        // The geometries are quoted
        $this->assertStringContainsString("\"1''\"", $cnx->sql);
    }
}
