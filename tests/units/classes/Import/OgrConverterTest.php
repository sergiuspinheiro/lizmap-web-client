<?php

use Lizmap\Import\CrsRequiredException;
use Lizmap\Import\OgrConverter;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class OgrConverterTest extends TestCase
{
    protected $tmpDir;

    protected function setUp(): void
    {
        $converter = new OgrConverter();
        if (!$converter->isAvailable()) {
            $this->markTestSkipped('GDAL/OGR is not installed');
        }
        $this->tmpDir = sys_get_temp_dir().'/'.uniqid('ogrtest_');
        mkdir($this->tmpDir);
        file_put_contents($this->tmpDir.'/points.csv', "name,lon,lat\nLisboa,-9.14,38.72\nPorto,-8.61,41.15\n");
    }

    protected function tearDown(): void
    {
        if ($this->tmpDir) {
            array_map('unlink', glob($this->tmpDir.'/*'));
            rmdir($this->tmpDir);
        }
    }

    public function testSupported(): void
    {
        $this->assertTrue(OgrConverter::isSupported('DXF'));
        $this->assertTrue(OgrConverter::isSupported('gpkg'));
        $this->assertFalse(OgrConverter::isSupported('php'));
        $this->assertFalse(OgrConverter::isSupported('vrt'));
    }

    public function testCsv(): void
    {
        $converter = new OgrConverter();
        $geojson = $converter->toGeoJson($this->tmpDir.'/points.csv', 'csv');
        $this->assertEquals('FeatureCollection', $geojson['type']);
        $this->assertCount(2, $geojson['features']);
        $this->assertEquals(array(-9.14, 38.72), $geojson['features'][0]['geometry']['coordinates']);
        $this->assertEquals(array('name' => 'Lisboa'), $geojson['features'][0]['properties']);
    }

    public function testZippedCsvAndGeoPackageLayers(): void
    {
        $zip = new ZipArchive();
        $zip->open($this->tmpDir.'/points.zip', ZipArchive::CREATE);
        $zip->addFile($this->tmpDir.'/points.csv', 'data/points.csv');
        $zip->close();

        $converter = new OgrConverter();
        $this->assertEquals(
            '/vsizip/'.$this->tmpDir.'/points.zip/data/points.csv',
            $converter->datasetPath($this->tmpDir.'/points.zip', 'zip')
        );
        $geojson = $converter->toGeoJson($this->tmpDir.'/points.zip', 'zip');
        $this->assertCount(2, $geojson['features']);

        // GeoPackage with two layers, one in PT-TM06
        $csv = escapeshellarg($this->tmpDir.'/points.csv');
        $gpkg = escapeshellarg($this->tmpDir.'/two.gpkg');
        $oo = '-oo X_POSSIBLE_NAMES=lon -oo Y_POSSIBLE_NAMES=lat -s_srs EPSG:4326';
        exec("ogr2ogr -f GPKG {$gpkg} {$csv} {$oo} -nln cities");
        exec("ogr2ogr -update -f GPKG {$gpkg} {$csv} {$oo} -t_srs EPSG:3763 -nln cities_tm");
        $this->assertEquals(array('cities', 'cities_tm'), $converter->layers($this->tmpDir.'/two.gpkg'));
        $geojson = $converter->toGeoJson($this->tmpDir.'/two.gpkg', 'gpkg');
        $this->assertCount(4, $geojson['features']);
        $this->assertEquals('cities_tm', $geojson['features'][3]['properties']['layer']);
        $coordinates = $geojson['features'][3]['geometry']['coordinates'];
        $this->assertEqualsWithDelta(-8.61, $coordinates[0], 0.0001);
        $this->assertEqualsWithDelta(41.15, $coordinates[1], 0.0001);
    }

    public function testFilesWithoutCrs(): void
    {
        $converter = new OgrConverter();
        // Coordinates in PT-TM06, which can't be longitudes and latitudes
        file_put_contents($this->tmpDir.'/tm06.csv', "name,x,y\nPorto,-41316.6,165270.4\n");
        try {
            $converter->toGeoJson($this->tmpDir.'/tm06.csv', 'csv');
            $this->fail('The CRS should be required');
        } catch (CrsRequiredException $e) {
            $this->assertStringContainsString('coordinate reference system', $e->getMessage());
        }
        $geojson = $converter->toGeoJson($this->tmpDir.'/tm06.csv', 'csv', 'EPSG:3763');
        $coordinates = $geojson['features'][0]['geometry']['coordinates'];
        $this->assertEqualsWithDelta(-8.6253, $coordinates[0], 0.0001);
        $this->assertEqualsWithDelta(41.1556, $coordinates[1], 0.0001);

        // An invalid CRS is ignored
        $this->expectException(CrsRequiredException::class);
        $converter->toGeoJson($this->tmpDir.'/tm06.csv', 'csv', 'EPSG:3763 -oo');
    }

    public function testDxfAlwaysNeedsCrs(): void
    {
        $converter = new OgrConverter();
        $csv = escapeshellarg($this->tmpDir.'/points.csv');
        $dxf = escapeshellarg($this->tmpDir.'/points.dxf');
        exec("ogr2ogr -f DXF {$dxf} {$csv} -oo X_POSSIBLE_NAMES=lon -oo Y_POSSIBLE_NAMES=lat 2>/dev/null");
        $this->assertFalse($converter->layerInfo($this->tmpDir.'/points.dxf', 'entities')['hasCrs']);
        $geojson = $converter->toGeoJson($this->tmpDir.'/points.dxf', 'dxf', 'EPSG:4326');
        $this->assertCount(2, $geojson['features']);
        $this->expectException(CrsRequiredException::class);
        $converter->toGeoJson($this->tmpDir.'/points.dxf', 'dxf');
    }

    public function testGeographicExtent(): void
    {
        $this->assertTrue(OgrConverter::isGeographicExtent(array(-9.5, 37.0, -6.2, 42.1)));
        $this->assertFalse(OgrConverter::isGeographicExtent(array(-41316.6, 165270.4, -41316.6, 165270.4)));
        $this->assertFalse(OgrConverter::isGeographicExtent(null));
    }

    public function testInvalidFile(): void
    {
        file_put_contents($this->tmpDir.'/empty.zip', 'not a zip');
        $converter = new OgrConverter();
        $this->expectException(RuntimeException::class);
        $converter->toGeoJson($this->tmpDir.'/empty.zip', 'zip');
    }
}
