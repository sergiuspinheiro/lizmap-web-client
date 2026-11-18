<?php

/**
 * Check the AI assistant configuration from the command line: sends a small
 * search to the configured provider and prints the answer, or the full
 * error returned by the provider API.
 *
 * Usage: php lizmap/scripts/ai-assistant-check.php
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */
$root = dirname(__DIR__);

require $root.'/vendor/autoload.php';

require_once $root.'/modules/lizmap/lib/Ai/AssistantException.php';

require_once $root.'/modules/lizmap/lib/Ai/Assistant.php';

$ini = parse_ini_file($root.'/var/config/localconfig.ini.php', true, INI_SCANNER_RAW);
$config = $ini['lizmapAi'] ?? array();
// The settings saved in the administration (Modules page) take precedence
$modulesFile = $root.'/var/config/lizmapModules.ini.php';
if (is_file($modulesFile)) {
    $modules = parse_ini_file($modulesFile, true, INI_SCANNER_RAW);
    foreach ($modules['lizmapAi'] ?? array() as $key => $value) {
        if ($value !== '') {
            $config[$key] = $value;
        }
    }
    if (isset($modules['modules']['aiAssistant'])) {
        $config['enabled'] = $modules['modules']['aiAssistant'];
    }
}
$assistant = new Lizmap\Ai\Assistant($config);
echo 'Provider: '.$assistant->provider().', enabled: '.($assistant->isEnabled() ? 'yes' : 'no')."\n";
echo 'URL: '.($config['url'] ?? ($config['ollamaUrl'] ?? '(default)')).', model: '.($config['model'] ?? '(default)')."\n";
if (class_exists('Composer\InstalledVersions') && Composer\InstalledVersions::isInstalled('anthropic-ai/sdk')) {
    echo 'Anthropic SDK: '.Composer\InstalledVersions::getPrettyVersion('anthropic-ai/sdk')."\n";
}

$layers = array(
    Lizmap\Ai\Assistant::layerIndexEntry('demo', 'Demo', 'transport', 'Transportes', array('name' => 'bus', 'title' => 'Paragens de autocarro', 'geometryType' => 'point')),
    Lizmap\Ai\Assistant::layerIndexEntry('demo', 'Demo', 'ortho', 'Ortofotos', array('name' => 'ortho', 'title' => 'Ortofotomapa 2025')),
);

try {
    $result = $assistant->search('transportes', $layers);
    echo "OK\n";
    print_r($result);
} catch (Throwable $e) {
    echo 'Error: '.$e->getMessage()."\n";
    $previous = $e->getPrevious() ?? $e;
    echo 'Class: '.get_class($previous)."\n";
    foreach (array('status', 'body') as $property) {
        if (property_exists($previous, $property)) {
            echo ucfirst($property).': '.print_r($previous->{$property}, true)."\n";
        }
    }
    if (property_exists($previous, 'response') && isset($previous->response)) {
        $stream = $previous->response->getBody();
        if ($stream->isSeekable()) {
            $stream->rewind();
        }
        echo 'Response: '.(string) $stream."\n";
    }
}
echo 'Details: '.$assistant->lastAnswerInfo()."\n";
