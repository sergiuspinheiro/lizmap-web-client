<?php

use Lizmap\Import\SharedServices;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class SharedServicesTest extends TestCase
{
    protected $file;

    protected function setUp(): void
    {
        $this->file = sys_get_temp_dir().'/'.uniqid('services_').'.json';
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
    }

    public function testSaveEditDelete(): void
    {
        $store = new SharedServices($this->file);
        $this->assertEquals(array(), $store->all());

        list($service, $errors) = $store->save(array(
            'type' => 'wms', 'url' => 'https://example.com/wms?SERVICE=WMS', 'title' => '<b>Ortos</b>',
            'access' => 'restricted', 'groups' => array('tecnicos'), 'users' => 'ana, rui ana',
        ));
        $this->assertEquals(array(), $errors);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{16}$/', $service['id']);
        $this->assertEquals('Ortos', $service['title']);
        $this->assertEquals(array('ana', 'rui'), $service['users']);

        $store->setTest($service['id'], array('ok' => true, 'message' => 'OK, 3 layer(s)'));
        $this->assertTrue($store->get($service['id'])['test']['ok']);

        // Same address: the test is kept, groups are emptied for all
        list($edited) = $store->save(array('type' => 'wms', 'url' => 'https://example.com/wms?SERVICE=WMS', 'title' => 'Ortofotos', 'access' => 'all', 'groups' => array('tecnicos')), $service['id']);
        $this->assertEquals('Ortofotos', $edited['title']);
        $this->assertEquals(array(), $edited['groups']);
        $this->assertTrue($edited['test']['ok']);
        // Another address: the test is removed
        list($edited) = $store->save(array('type' => 'wms', 'url' => 'https://other.com/wms', 'access' => 'all'), $service['id']);
        $this->assertNull($edited['test']);
        $this->assertEquals('other.com', $edited['title']);
        $this->assertCount(1, $store->all());

        $this->assertEquals(array('id'), $store->save(array('type' => 'wms', 'url' => 'https://a.com'), 'ffffffffffffffff')[1]);
        $this->assertTrue($store->delete($service['id']));
        $this->assertFalse($store->delete($service['id']));
        $this->assertEquals(array(), $store->all());
    }

    public function testInvalid(): void
    {
        $this->assertEquals(array('type'), SharedServices::normalize(array('type' => 'ftp', 'url' => 'https://a.com'))[1]);
        $this->assertEquals(array('url'), SharedServices::normalize(array('type' => 'wms', 'url' => 'javascript:alert(1)'))[1]);
        $this->assertEquals(array('access'), SharedServices::normalize(array('type' => 'wms', 'url' => 'https://a.com', 'access' => 'x'))[1]);
        $this->assertEquals(array('groups'), SharedServices::normalize(array('type' => 'wms', 'url' => 'https://a.com', 'access' => 'restricted'))[1]);
        $this->assertEquals(array('users'), SharedServices::normalize(array('type' => 'wms', 'url' => 'https://a.com', 'access' => 'restricted', 'users' => 'a"b'))[1]);
    }

    public function testForUser(): void
    {
        $store = new SharedServices($this->file);
        $store->save(array('type' => 'wms', 'url' => 'https://a.com/wms', 'title' => 'A', 'access' => 'all'));
        $store->save(array('type' => 'wfs', 'url' => 'https://b.com/wfs', 'title' => 'B', 'access' => 'connected'));
        $store->save(array('type' => 'xyz', 'url' => 'https://c.com/{z}/{x}/{y}.png', 'title' => 'C', 'access' => 'restricted', 'groups' => array('tecnicos')));
        $store->save(array('type' => 'geojson', 'url' => 'https://d.com/d.geojson', 'title' => 'D', 'access' => 'restricted', 'users' => 'ana'));

        $titles = static function ($services) {
            return array_column($services, 'title');
        };
        $this->assertEquals(array('A'), $titles($store->forUser(null, array())));
        $this->assertEquals(array('A', 'B'), $titles($store->forUser('rui', array('users'))));
        $this->assertEquals(array('A', 'B', 'C'), $titles($store->forUser('rui', array('tecnicos'))));
        $this->assertEquals(array('A', 'B', 'D'), $titles($store->forUser('ana', array())));
        // The access rules are not given to the users
        $this->assertArrayNotHasKey('groups', $store->forUser('ana', array())[0]);
    }

    public function testTestUrl(): void
    {
        $this->assertEquals('https://a.com/wms?map=x&SERVICE=WMS&REQUEST=GetCapabilities',
            SharedServices::testUrl('wms', 'https://a.com/wms?map=x&request=GetMap&SERVICE=WMS'));
        $this->assertEquals('https://a.com/ogc/collections?f=json', SharedServices::testUrl('ogcapi', 'https://a.com/ogc/collections'));
        $this->assertEquals('https://a.com/MapServer?f=json', SharedServices::testUrl('arcgis', 'https://a.com/MapServer?f=pjson'));
        $this->assertEquals('https://a.com/0/0/0.png', SharedServices::testUrl('xyz', 'https://a.com/{z}/{x}/{y}.png'));
    }

    public function testCheckResponse(): void
    {
        $wms = '<WMS_Capabilities><Capability><Layer><Title>Root</Title><Layer queryable="1"><Name>a</Name></Layer><Layer><Name>b</Name></Layer></Layer></Capability></WMS_Capabilities>';
        $this->assertEquals(array('ok' => true, 'message' => 'OK, 2 layer(s)'), SharedServices::checkResponse('wms', 200, 'text/xml', $wms));
        $this->assertFalse(SharedServices::checkResponse('wms', 200, 'text/xml', '<ServiceExceptionReport/>')['ok']);
        $this->assertFalse(SharedServices::checkResponse('wms', 404, 'text/html', '')['ok']);
        $this->assertTrue(SharedServices::checkResponse('wfs', 200, 'text/xml', '<wfs:WFS_Capabilities><FeatureTypeList><FeatureType><Name>x</Name></FeatureType></FeatureTypeList></wfs:WFS_Capabilities>')['ok']);
        $this->assertTrue(SharedServices::checkResponse('ogcapi', 200, 'application/json', '{"collections":[{"id":"a"}]}')['ok']);
        $this->assertFalse(SharedServices::checkResponse('arcgis', 200, 'application/json', '{"error":{"message":"Token required"}}')['ok']);
        $this->assertTrue(SharedServices::checkResponse('xyz', 200, 'image/png', 'PNG')['ok']);
        $this->assertFalse(SharedServices::checkResponse('xyz', 200, 'text/html', '<html>')['ok']);
        $this->assertTrue(SharedServices::checkResponse('geojson', 200, 'application/json', '{"type":"FeatureCollection","features":[]}')['ok']);
    }
}
