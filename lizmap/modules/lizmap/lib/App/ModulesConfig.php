<?php

/**
 * Activation of the optional modules of the map (data catalog, layer
 * comparison, AI assistant) and settings of the AI assistant, edited in the
 * administration and saved in var/config/lizmapModules.ini.php.
 *
 * The settings of the [lizmapAi] and [catalogImport] sections of
 * localconfig.ini.php are the defaults: the administration overrides them.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\App;

use Jelix\IniFile\IniModifier;

class ModulesConfig
{
    /** Name of the configuration file, in var/config */
    public const FILE = 'lizmapModules.ini.php';

    /** The optional modules */
    public const MODULES = array('catalog', 'layerCompare', 'aiAssistant');

    /** Settings of the AI assistant editable in the administration */
    public const AI_SETTINGS = array('provider', 'model', 'searchModel', 'url', 'allowAnonymous', 'sendStatistics', 'sendFeatures', 'maxFeatures', 'maxRows', 'contextLength', 'requestsPerHour');

    /** Default number of requests to the AI assistant by user and hour */
    public const DEFAULT_REQUESTS_PER_HOUR = 60;

    /** @var array<string, array> cache of the files read, by path */
    protected static $cache = array();

    /** @var string */
    protected $path;

    /** @var array the [lizmapAi] section of localconfig.ini.php */
    protected $localAi;

    /** @var array the [catalogImport] section of localconfig.ini.php */
    protected $localImport;

    /**
     * @param null|string $path     the configuration file, by default var/config/lizmapModules.ini.php
     * @param null|object $appConfig the application configuration, by default jApp::config()
     */
    public function __construct($path = null, $appConfig = null)
    {
        $this->path = $path ?? \jApp::varConfigPath(self::FILE);
        $appConfig = $appConfig ?? \jApp::config();
        $this->localAi = isset($appConfig->lizmapAi) ? (array) $appConfig->lizmapAi : array();
        $this->localImport = isset($appConfig->catalogImport) ? (array) $appConfig->catalogImport : array();
    }

    /**
     * @return array the sections of the file
     */
    protected function read()
    {
        if (!array_key_exists($this->path, self::$cache)) {
            $data = is_file($this->path) ? parse_ini_file($this->path, true, INI_SCANNER_RAW) : array();
            self::$cache[$this->path] = is_array($data) ? $data : array();
        }

        return self::$cache[$this->path];
    }

    /**
     * @param mixed $value
     * @param bool  $default
     */
    protected static function bool($value, $default): bool
    {
        if ($value === null || $value === '') {
            return $default;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * Is a module enabled. The data catalog and the layer comparison are
     * enabled by default, the AI assistant when [lizmapAi] enabled=on.
     *
     * @param string $module one of MODULES
     */
    public function isEnabled($module): bool
    {
        $modules = $this->read()['modules'] ?? array();
        if ($module === 'aiAssistant') {
            return self::bool($modules['aiAssistant'] ?? null, self::bool($this->localAi['enabled'] ?? null, false));
        }

        return self::bool($modules[$module] ?? null, true);
    }

    /**
     * Configuration of the AI assistant, for Lizmap\Ai\Assistant.
     *
     * @return array the [lizmapAi] settings, with the ones of the administration
     */
    public function aiConfig(): array
    {
        $config = $this->localAi;
        $saved = $this->read()['lizmapAi'] ?? array();
        foreach (array_merge(self::AI_SETTINGS, array('apiKey')) as $key) {
            if (isset($saved[$key]) && $saved[$key] !== '') {
                $config[$key] = $saved[$key];
            }
        }
        $config['enabled'] = $this->isEnabled('aiAssistant') ? 'on' : 'off';

        return $config;
    }

    /**
     * Maximum number of requests to the AI assistant by user and hour.
     */
    public function requestsPerHour(): int
    {
        $value = (int) ($this->aiConfig()['requestsPerHour'] ?? 0);

        return $value > 0 ? $value : self::DEFAULT_REQUESTS_PER_HOUR;
    }

    /**
     * Does the AI assistant have an API key, saved in the administration or
     * in localconfig.ini.php. The key itself is never displayed.
     */
    public function hasApiKey(): bool
    {
        return trim((string) ($this->aiConfig()['apiKey'] ?? '')) !== '';
    }

    /**
     * Quota of the imported files saved in the user profile.
     *
     * @return array{quotaSize: mixed, quotaLayers: mixed} the [catalogImport] settings
     */
    public function importConfig(): array
    {
        $config = $this->localImport;
        $saved = $this->read()['catalogImport'] ?? array();
        foreach (array('quotaSize', 'quotaLayers') as $key) {
            if (isset($saved[$key]) && $saved[$key] !== '') {
                $config[$key] = $saved[$key];
            }
        }

        return $config;
    }

    /**
     * Current values, for the form of the administration. The API key is not given.
     *
     * @return array the values
     */
    public function formValues(): array
    {
        $ai = $this->aiConfig();
        $import = $this->importConfig();
        $bool = static function ($value, $default) {
            return self::bool($value, $default) ? 'on' : 'off';
        };

        return array(
            'catalog' => $this->isEnabled('catalog') ? 'on' : 'off',
            'layerCompare' => $this->isEnabled('layerCompare') ? 'on' : 'off',
            'aiAssistant' => $this->isEnabled('aiAssistant') ? 'on' : 'off',
            'provider' => array_key_exists((string) ($ai['provider'] ?? ''), \Lizmap\Ai\Assistant::PROVIDERS)
                ? $ai['provider'] : \Lizmap\Ai\Assistant::DEFAULT_PROVIDER,
            'model' => (string) ($ai['model'] ?? ''),
            'searchModel' => (string) ($ai['searchModel'] ?? ''),
            'url' => (string) ($ai['url'] ?? ($ai['ollamaUrl'] ?? '')),
            'allowAnonymous' => $bool($ai['allowAnonymous'] ?? null, false),
            'sendStatistics' => $bool($ai['sendStatistics'] ?? null, true),
            'maxFeatures' => (string) ($ai['maxFeatures'] ?? '1000'),
            // By default, the features are sent to a local model only
            'sendFeatures' => $bool($ai['sendFeatures'] ?? null, ($ai['provider'] ?? \Lizmap\Ai\Assistant::DEFAULT_PROVIDER) === 'ollama'),
            'maxRows' => (string) ($ai['maxRows'] ?? '100'),
            'contextLength' => (string) ($ai['contextLength'] ?? '8192'),
            'requestsPerHour' => (string) $this->requestsPerHour(),
            'quotaSize' => (string) ($import['quotaSize'] ?? '20'),
            'quotaLayers' => (string) ($import['quotaLayers'] ?? '20'),
        );
    }

    /**
     * Check and save the settings of the administration.
     *
     * @param array $data the form data: modules (bool by module), ai settings,
     *                    apiKey (empty to keep the current one), removeApiKey,
     *                    quotaSize and quotaLayers
     *
     * @return string[] the errors, the settings are saved when there is none
     */
    public function save(array $data): array
    {
        $errors = array();
        $modules = array();
        foreach (self::MODULES as $module) {
            $modules[$module] = !empty($data['modules'][$module]) ? 'on' : 'off';
        }

        $provider = (string) ($data['provider'] ?? '');
        if (!array_key_exists($provider, \Lizmap\Ai\Assistant::PROVIDERS)) {
            $errors[] = 'provider';
        }
        $url = trim((string) ($data['url'] ?? ''));
        if ($url !== '' && (!filter_var($url, FILTER_VALIDATE_URL) || !preg_match('#^https?://#i', $url))) {
            $errors[] = 'url';
        }
        $model = trim((string) ($data['model'] ?? ''));
        if (mb_strlen($model) > 100 || preg_match('/[\r\n"]/', $model)) {
            $errors[] = 'model';
        }
        $searchModel = trim((string) ($data['searchModel'] ?? ''));
        if (mb_strlen($searchModel) > 100 || preg_match('/[\r\n"]/', $searchModel)) {
            $errors[] = 'searchModel';
        }
        $apiKey = trim((string) ($data['apiKey'] ?? ''));
        if (preg_match('/[\s"]/', $apiKey) || strlen($apiKey) > 500) {
            $errors[] = 'apiKey';
        }
        $numbers = array(
            'maxFeatures' => array(1, 100000),
            'maxRows' => array(1, 2000),
            'contextLength' => array(2048, 131072),
            'requestsPerHour' => array(1, 10000),
            'quotaSize' => array(1, 10000),
            'quotaLayers' => array(1, 10000),
        );
        $values = array();
        foreach ($numbers as $key => list($min, $max)) {
            $value = trim((string) ($data[$key] ?? ''));
            if ($value !== '' && (!ctype_digit($value) || (int) $value < $min || (int) $value > $max)) {
                $errors[] = $key;
            }
            $values[$key] = $value;
        }
        if ($errors) {
            return $errors;
        }

        $current = $this->read()['lizmapAi'] ?? array();
        $ai = array(
            'provider' => $provider,
            'model' => $model,
            'searchModel' => $searchModel,
            'url' => $url,
            'allowAnonymous' => !empty($data['allowAnonymous']) ? 'on' : 'off',
            'sendStatistics' => !empty($data['sendStatistics']) ? 'on' : 'off',
            'maxFeatures' => $values['maxFeatures'],
            'sendFeatures' => !empty($data['sendFeatures']) ? 'on' : 'off',
            'maxRows' => $values['maxRows'],
            'contextLength' => $values['contextLength'],
            'requestsPerHour' => $values['requestsPerHour'],
            // The key is not displayed: an empty field keeps the saved one
            'apiKey' => !empty($data['removeApiKey']) ? '' : ($apiKey !== '' ? $apiKey : ($current['apiKey'] ?? '')),
        );

        if (!is_file($this->path)) {
            file_put_contents($this->path, ";<?php die(''); ?>\n;for security reasons, don't remove or modify the first line\n");
            @chmod($this->path, 0640);
        }
        $ini = new IniModifier($this->path);
        $ini->setValues($modules, 'modules');
        $ini->setValues($ai, 'lizmapAi');
        $ini->setValues(array('quotaSize' => $values['quotaSize'], 'quotaLayers' => $values['quotaLayers']), 'catalogImport');
        $ini->save();
        unset(self::$cache[$this->path]);

        return array();
    }
}
