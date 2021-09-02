<?php
use PHPUnit\Framework\TestCase;
use Lizmap\Project;

/**
 * @internal
 * @coversNothing
 */
class projectConfigTest extends TestCase
{
    public function getConstructData()
    {
        $file = __DIR__.'/Ressources/events.qgs.cfg';

        return array(
            array(null, json_decode(file_get_contents($file))),
            array(array('cfgContent' => json_decode(file_get_contents($file))), json_decode(file_get_contents($file))),
        );
    }

    /**
     * @dataProvider getConstructData
     *
     * @param mixed $data
     * @param mixed $expectedData
     */
    public function testConstruct($data, $expectedData)
    {
        $file = __DIR__.'/Ressources/events.qgs.cfg';
        $testCfg = new Project\ProjectConfig($file, $data);
        $this->assertEquals($expectedData, $testCfg->getConfigContent());
    }

    public function testConstructCache()
    {
        $file = __DIR__.'/Ressources/events.qgs.cfg';
        $json = json_decode(file_get_contents($file));
        $data = array('cfgContent' => $json);
        foreach ($json as $key => $prop) {
            $data[$key] = $json->{$key};
        }
        $cachedProperties = array('layersOrder', 'locateByLayer', 'formFilterLayers', 'editionLayers',
            'attributeLayers', 'cfgContent', 'options', 'layers', );
        $testCfg = new Project\ProjectConfig($file, $data);
        foreach ($cachedProperties as $prop) {
            if (array_key_exists($prop, $data)) {
                $this->assertEquals($data[$prop], $testCfg->getProperty($prop), 'failed Prop = '.$prop);
            }
        }
    }

    public function getFindLayerData()
    {
        $file = __DIR__.'/Ressources/events.qgs.cfg';
        $json = json_decode(file_get_contents($file));
        $layers = array('cfgContent' => (object) array('layers' => $json->layers));
        $layersNull = array('cfgContent' => (object) array('layers' => null));

        return array(
            array($layers, 'events_4c3b47b8_3939_4c8c_8e91_55bdb13a2101', 'montpellier_events'),
            array($layers, 'test_shortname', 'Hidden'),
            array($layers, 'Hidden', 'Hidden'),
            array($layers, 'osm-test', 'osm-stamen-toner'),
            array($layers, 'test', null),
            array($layers, null, null),
            array($layersNull, 'test', null),
            array($layersNull, null, null),
        );
    }

    /**
     * @dataProvider getFindLayerData
     *
     * @param mixed $layers
     * @param mixed $key
     * @param mixed $layerName
     */
    public function testFindLayer($layers, $key, $layerName)
    {
        $testCfg = new Project\ProjectConfig(null, $layers);
        if ($layerName) {
            $this->assertSame($testCfg->getProperty('layers')->{$layerName}, $testCfg->findLayerByAnyName($key));
        } else {
            $this->assertNull($testCfg->findLayerByAnyName($key));
        }
    }

    public function getEditionLayerByNameData()
    {
        $file = __DIR__.'/Ressources/montpellier.qgs.cfg';
        $json = json_decode(file_get_contents($file));
        $eLayer = array('editionLayers' => $json->editionLayers);
        $eLayerNull = array('editionLayers' => null);

        return array(
            array($eLayer, 'tramstop'),
            array($eLayer, 'tram_stop_work'),
            array($eLayerNull, null),
        );
    }

    /**
     * @dataProvider getEditionLayerByNameData
     *
     * @param mixed $eLayers
     * @param mixed $name
     */
    public function testGetEditionLayerByName($eLayers, $name)
    {
        $testCfg = new Project\ProjectConfig(null, $eLayers);
        if ($name) {
            $this->assertSame($testCfg->getProperty('editionLayers')->{$name}, $testCfg->getEditionLayerByName($name));
        } else {
            $this->assertNull($testCfg->getEditionLayerByName($name));
        }
    }

    public function getEditionLayerByLayerIdData()
    {
        $file = __DIR__.'/Ressources/montpellier.qgs.cfg';
        $json = json_decode(file_get_contents($file));
        $eLayer = array('editionLayers' => $json->editionLayers);
        $eLayerNull = array('editionLayers' => null);

        return array(
            array($eLayer, 'edition_line20130409161630329', 'edition_line'),
            array($eLayer, 'edition_polygon20130409114333776', 'areas_of_interest'),
            array($eLayer, 'null', null),
            array($eLayerNull, 'null', null),
            array($eLayerNull, null, null),
        );
    }

    /**
     * @dataProvider getEditionLayerByLayerIdData
     *
     * @param mixed $eLayers
     * @param mixed $id
     * @param mixed $eLayerName
     */
    public function testGetEditionLayerByLayerId($eLayers, $id, $eLayerName)
    {
        $testCfg = new Project\ProjectConfig(null, $eLayers);
        if ($eLayerName) {
            $this->assertSame($testCfg->getProperty('editionLayers')->{$eLayerName}, $testCfg->getEditionLayerByLayerId($id));
        } else {
            $this->assertNull($testCfg->getEditionLayerByLayerId($id));
        }
    }

    public function getOptionsValues()
    {
        return array(
            array('mapScales', [
                1000,
                2500,
                5000,
                10000,
                25000,
                50000,
                100000,
                150000
            ]),
            array('minScale', 1000),
            array('maxScale', 150000),
            array('initialExtent',  [
                417006.613738,
                5394910.3409,
                447158.048911,
                5414844.99481
            ]),
            array('osmMapnik', "True"),
            array('measure', "True"),
            array('atlasDuration', 5),
        );
    }

    /**
     * @dataProvider getOptionsValues
     *
     * @param mixed $option
     * @param mixed $expectedValue
     */
    public function testGetOption($option, $expectedValue)
    {
        $file = __DIR__.'/Ressources/montpellier.qgs.cfg';
        $testCfg = new Project\ProjectConfig($file);
        $this->assertEquals($expectedValue, $testCfg->getOption($option));
    }
}
