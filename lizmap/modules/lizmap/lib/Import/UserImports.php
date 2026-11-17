<?php

/**
 * Files imported by users and saved in their profile: right, quota and
 * validation of the saved GeoJSON.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Import;

class UserImports
{
    /** @var string Right to save imported files, per repository */
    public const RIGHT = 'lizmap.tools.import.save';

    /** @var string Database profile of the users tables */
    public const PROFILE = 'jauth';

    /** @var int Default quota of a user, in MB */
    public const DEFAULT_QUOTA_SIZE = 20;

    /** @var int Default maximum number of saved files of a user */
    public const DEFAULT_QUOTA_LAYERS = 20;

    /** @var int Maximum number of external services saved by a user */
    public const MAX_SERVICES = 50;

    /** @var string[] Types of external services of the data catalog */
    public const SERVICE_TYPES = array('wms', 'wmts', 'wfs', 'ogcapi', 'arcgis', 'xyz', 'geojson');

    /**
     * Validate an external service saved by a user.
     *
     * @param string $type  the service type
     * @param string $url   the service URL
     * @param string $title the service title
     *
     * @return null|array{type: string, url: string, title: string} the service, or null if invalid
     */
    public static function normalizeService($type, $url, $title)
    {
        $type = (string) $type;
        $url = trim((string) $url);
        $title = trim(strip_tags((string) $title));
        if (!in_array($type, self::SERVICE_TYPES, true) || strlen($url) > 2000) {
            return null;
        }
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if (!in_array($scheme, array('http', 'https')) || !parse_url($url, PHP_URL_HOST)) {
            return null;
        }
        if ($title === '') {
            $title = (string) parse_url($url, PHP_URL_HOST);
        }

        return array('type' => $type, 'url' => $url, 'title' => mb_substr($title, 0, 200));
    }

    /**
     * Quota of each user, from the [catalogImport] section of the
     * configuration (quotaSize in MB, quotaLayers).
     *
     * @param null|array $config the configuration section, read from the application by default
     *
     * @return array{size: int, layers: int} the maximum size in bytes and number of files
     */
    public static function quota($config = null)
    {
        if ($config === null) {
            $appConfig = \jApp::config();
            $config = isset($appConfig->catalogImport) && is_array($appConfig->catalogImport) ? $appConfig->catalogImport : array();
        }
        $size = isset($config['quotaSize']) ? (float) $config['quotaSize'] : self::DEFAULT_QUOTA_SIZE;
        $layers = isset($config['quotaLayers']) ? (int) $config['quotaLayers'] : self::DEFAULT_QUOTA_LAYERS;

        return array(
            'size' => (int) max(0, $size * 1024 * 1024),
            'layers' => max(0, $layers),
        );
    }

    /**
     * Check a quota.
     *
     * @param array{size: int, layers: int} $quota     the quota
     * @param int                           $usedSize  size already used, in bytes
     * @param int                           $usedCount number of files already saved
     * @param int                           $newSize   size of the new file, in bytes
     *
     * @return bool true if the new file can be saved
     */
    public static function fitsQuota($quota, $usedSize, $usedCount, $newSize)
    {
        return $usedCount + 1 <= $quota['layers'] && $usedSize + $newSize <= $quota['size'];
    }

    /**
     * Validate and normalize the GeoJSON of an imported file: only a
     * FeatureCollection of features with a geometry and scalar properties.
     *
     * @param string $json the GeoJSON text
     *
     * @return null|string the normalized GeoJSON, or null if invalid
     */
    public static function normalizeGeoJson($json)
    {
        $data = json_decode($json, true);
        if (!is_array($data) || ($data['type'] ?? '') !== 'FeatureCollection'
            || !isset($data['features']) || !is_array($data['features'])) {
            return null;
        }
        $features = array();
        foreach ($data['features'] as $feature) {
            if (!is_array($feature) || ($feature['type'] ?? '') !== 'Feature'
                || !isset($feature['geometry']['type'], $feature['geometry']['coordinates'])
                || !is_string($feature['geometry']['type'])
                || !is_array($feature['geometry']['coordinates'])) {
                continue;
            }
            $properties = array();
            if (isset($feature['properties']) && is_array($feature['properties'])) {
                foreach ($feature['properties'] as $key => $value) {
                    if (is_scalar($value) || $value === null) {
                        $properties[(string) $key] = $value;
                    }
                }
            }
            $features[] = array(
                'type' => 'Feature',
                // An object, also when there is no property
                'properties' => (object) $properties,
                'geometry' => array(
                    'type' => $feature['geometry']['type'],
                    'coordinates' => $feature['geometry']['coordinates'],
                ),
            );
        }
        if (count($features) == 0) {
            return null;
        }

        return json_encode(array('type' => 'FeatureCollection', 'features' => $features));
    }

    /**
     * Create the table and the right on existing installations, once.
     */
    public static function ensureInstalled()
    {
        $flag = \jApp::tempPath('lizmap_user_import.v2.created');
        if (file_exists($flag)) {
            return;
        }

        try {
            $db = \jDb::getConnection(self::PROFILE);
            $file = \jApp::getModulePath('lizmap').'/install/sql/lizmapuserimport.'.$db->dbms.'.sql';
            if (file_exists($file)) {
                $db->tools()->execSQLScript($file);
            }

            $subjects = \jDao::get('jacl2db~jacl2subject', 'jacl2_profile');
            if (!$subjects->get(self::RIGHT)) {
                \jAcl2DbManager::createRight(self::RIGHT, 'admin~jacl2.'.self::RIGHT, 'lizmap.grp');
            }
            file_put_contents($flag, '1');
        } catch (\Throwable $e) {
            \jLog::log('User imports install: '.$e->getMessage(), 'lizmapadmin');
        }
    }
}
