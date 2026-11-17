<?php

use Lizmap\App\ModulesConfig;
use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 */
#[CoversNothing]
class ModulesConfigTest extends TestCase
{
    protected $file;

    protected function setUp(): void
    {
        $this->file = sys_get_temp_dir().'/'.uniqid('modules_').'.ini.php';
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
    }

    protected function config()
    {
        return new ModulesConfig($this->file, (object) array(
            'lizmapAi' => array('enabled' => 'on', 'provider' => 'ollama', 'model' => 'gemma3:4b'),
            'catalogImport' => array('quotaSize' => '30'),
        ));
    }

    public function testDefaults(): void
    {
        $config = $this->config();
        $this->assertTrue($config->isEnabled('catalog'));
        $this->assertTrue($config->isEnabled('layerCompare'));
        // From [lizmapAi] enabled
        $this->assertTrue($config->isEnabled('aiAssistant'));
        $this->assertEquals('30', $config->formValues()['quotaSize']);
        $this->assertEquals(ModulesConfig::DEFAULT_REQUESTS_PER_HOUR, $config->requestsPerHour());
        $this->assertFalse($config->hasApiKey());
    }

    public function testInvalidValues(): void
    {
        $errors = $this->config()->save(array(
            'provider' => 'evil',
            'url' => 'file:///etc/passwd',
            'apiKey' => "key\nother=1",
            'maxFeatures' => 'abc',
        ));
        $this->assertEquals(array('provider', 'url', 'apiKey', 'maxFeatures'), $errors);
        $this->assertFileDoesNotExist($this->file);
    }

    public function testSave(): void
    {
        $data = array(
            'modules' => array('catalog' => true, 'layerCompare' => false, 'aiAssistant' => true),
            'provider' => 'claude',
            'model' => '',
            'url' => '',
            'apiKey' => 'sk-test-123',
            'requestsPerHour' => '30',
            'quotaSize' => '50',
        );
        $this->assertEquals(array(), $this->config()->save($data));
        $config = $this->config();
        $this->assertFalse($config->isEnabled('layerCompare'));
        $this->assertTrue($config->hasApiKey());
        $this->assertEquals(30, $config->requestsPerHour());
        $this->assertEquals('claude', $config->aiConfig()['provider']);
        $this->assertEquals('sk-test-123', $config->aiConfig()['apiKey']);
        $this->assertEquals('50', $config->importConfig()['quotaSize']);
        $this->assertArrayNotHasKey('apiKey', $config->formValues());

        // An empty key keeps the saved one
        $data['apiKey'] = '';
        $this->config()->save($data);
        $this->assertTrue($this->config()->hasApiKey());
        $data['removeApiKey'] = true;
        $this->config()->save($data);
        $this->assertFalse($this->config()->hasApiKey());
    }
}
