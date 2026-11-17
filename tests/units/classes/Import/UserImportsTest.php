<?php

use Lizmap\Import\UserImports;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class UserImportsTest extends TestCase
{
    public function testQuota(): void
    {
        $this->assertEquals(array('size' => 20 * 1024 * 1024, 'layers' => 20), UserImports::quota(array()));
        $this->assertEquals(array('size' => 1024 * 1024, 'layers' => 5), UserImports::quota(array('quotaSize' => '1', 'quotaLayers' => '5')));
        $this->assertEquals(array('size' => 0, 'layers' => 0), UserImports::quota(array('quotaSize' => '-3', 'quotaLayers' => '-1')));
    }

    public function testFitsQuota(): void
    {
        $quota = array('size' => 100, 'layers' => 2);
        $this->assertTrue(UserImports::fitsQuota($quota, 0, 0, 100));
        $this->assertFalse(UserImports::fitsQuota($quota, 50, 1, 51));
        $this->assertFalse(UserImports::fitsQuota($quota, 0, 2, 1));
    }

    public function testNormalizeGeoJson(): void
    {
        $this->assertNull(UserImports::normalizeGeoJson('not json'));
        $this->assertNull(UserImports::normalizeGeoJson('{"type":"Feature"}'));
        $this->assertNull(UserImports::normalizeGeoJson('{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null}]}'));

        $json = json_encode(array(
            'type' => 'FeatureCollection',
            'crs' => 'removed',
            'features' => array(
                array(
                    'type' => 'Feature',
                    'id' => 'removed',
                    'properties' => array('name' => 'Lisboa', 'n' => 2, 'nested' => array('removed')),
                    'geometry' => array('type' => 'Point', 'coordinates' => array(-9.14, 38.72)),
                ),
                array('type' => 'Feature', 'properties' => array(), 'geometry' => null),
            ),
        ));
        $this->assertEquals(array(
            'type' => 'FeatureCollection',
            'features' => array(
                array(
                    'type' => 'Feature',
                    'properties' => array('name' => 'Lisboa', 'n' => 2),
                    'geometry' => array('type' => 'Point', 'coordinates' => array(-9.14, 38.72)),
                ),
            ),
        ), json_decode(UserImports::normalizeGeoJson($json), true));
    }
}
