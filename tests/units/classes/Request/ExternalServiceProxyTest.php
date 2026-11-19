<?php

use Lizmap\Request\ExternalServiceProxy;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class ExternalServiceProxyTest extends TestCase
{
    public static function getUrls(): array
    {
        return array(
            array('https://cartografia.dgterritorio.gov.pt/wms/ortos2015?service=wms', true),
            array('http://127.0.0.1/x', false),
            array('http://[::1]/', false),
            array('http://localhost:8080/', false),
            array('http://intra.example/', false),
            array('http://mix.example/', false),
            array('file:///etc/passwd', false),
            array('http://user:pass@cartografia.dgterritorio.gov.pt/', false),
            array('http://map.example.org/qgis?SERVICE=WMS', false),
            array('http://169.254.169.254/latest', false),
            array('http://100.64.1.1/', false),
            array('http://[::ffff:10.0.0.1]/', false),
            array('http://unknown.example/', false),
        );
    }

    #[DataProvider('getUrls')]
    public function testRefusal($url, $allowed): void
    {
        $hosts = array(
            'cartografia.dgterritorio.gov.pt' => array('195.23.0.10'),
            'intra.example' => array('10.0.0.5'),
            'mix.example' => array('8.8.8.8', 'fd00::1'),
        );
        $proxy = new ExternalServiceProxy('http://map.example.org/qgis', static function ($host) use ($hosts) {
            return $hosts[$host] ?? array();
        });
        $this->assertSame($allowed, $proxy->refusal($url) === null, $url);
    }

    public function testAbsoluteUrl(): void
    {
        $this->assertSame('https://h.pt:8443/a/b', ExternalServiceProxy::absoluteUrl('/a/b', 'https://h.pt:8443/x/y?z'));
        $this->assertSame('https://h.pt/x/c', ExternalServiceProxy::absoluteUrl('c', 'https://h.pt/x/y'));
        $this->assertSame('https://o.pt/c', ExternalServiceProxy::absoluteUrl('//o.pt/c', 'https://h.pt/x/y'));
        $this->assertSame('http://o.pt/c', ExternalServiceProxy::absoluteUrl('http://o.pt/c', 'https://h.pt/x/y'));
    }

    public function testReadLimited(): void
    {
        $stream = \GuzzleHttp\Psr7\Utils::streamFor(str_repeat('a', 200000));
        $this->assertSame(200000, strlen(ExternalServiceProxy::readLimited($stream, 300000)));

        $this->expectException(\InvalidArgumentException::class);
        ExternalServiceProxy::readLimited(\GuzzleHttp\Psr7\Utils::streamFor(str_repeat('a', 400000)), 300000);
    }
}
