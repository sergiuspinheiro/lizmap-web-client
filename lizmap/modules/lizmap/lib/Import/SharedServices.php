<?php

/**
 * External services configured and tested by the administrator, offered in
 * "Add an external service" of the data catalog to all the users, to the
 * connected ones, or to some groups and users. Saved in
 * var/config/catalogServices.json.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Import;

class SharedServices
{
    /** Name of the file, in var/config */
    public const FILE = 'catalogServices.json';

    /** Who can use a service: everybody, the connected users, or some groups and users */
    public const ACCESS = array('all', 'connected', 'restricted');

    /** Maximum number of services */
    public const MAX_SERVICES = 200;

    /** Maximum number of layers or services kept from a test */
    public const MAX_TEST_ITEMS = 200;

    /** Maximum number of groups or users of a service */
    public const MAX_MEMBERS = 500;

    /** @var string */
    protected $path;

    /**
     * @param null|string $path the file, by default var/config/catalogServices.json
     */
    public function __construct($path = null)
    {
        $this->path = $path ?? \jApp::varConfigPath(self::FILE);
    }

    /**
     * @return list<array> the services, in the order of their title
     */
    public function all(): array
    {
        if (!is_file($this->path)) {
            return array();
        }
        $data = json_decode((string) file_get_contents($this->path), true);
        $services = array();
        foreach ((is_array($data) ? ($data['services'] ?? array()) : array()) as $item) {
            if (!is_array($item) || !isset($item['id']) || !preg_match('/^[0-9a-f]{16}$/', (string) $item['id'])) {
                continue;
            }
            list($service) = self::normalize($item);
            if ($service) {
                $services[] = array('id' => $item['id']) + $service + array('test' => self::normalizeTest($item['test'] ?? null));
            }
        }
        usort($services, static function ($a, $b) {
            return strcasecmp($a['title'], $b['title']);
        });

        return $services;
    }

    /**
     * @param string $id the service id
     *
     * @return null|array the service
     */
    public function get($id): ?array
    {
        foreach ($this->all() as $service) {
            if ($service['id'] === $id) {
                return $service;
            }
        }

        return null;
    }

    /**
     * Add or replace a service.
     *
     * @param array       $data the service: type, url, title, description, access, groups, users
     * @param null|string $id   the service to replace, null to add one
     *
     * @return array{0: null|array, 1: string[]} the saved service, or the invalid fields
     */
    public function save(array $data, $id = null): array
    {
        list($service, $errors) = self::normalize($data);
        if ($errors) {
            return array(null, $errors);
        }
        $services = $this->all();
        $index = null;
        foreach ($services as $i => $item) {
            if ($id !== null && $item['id'] === $id) {
                $index = $i;
            }
        }
        if ($id !== null && $index === null) {
            return array(null, array('id'));
        }
        if ($index === null) {
            if (count($services) >= self::MAX_SERVICES) {
                return array(null, array('count'));
            }
            $services[] = array('id' => bin2hex(random_bytes(8))) + $service + array('test' => null);
            $index = count($services) - 1;
        } else {
            $test = $services[$index]['test'];
            // A test of another address is no longer valid
            if ($services[$index]['url'] !== $service['url'] || $services[$index]['type'] !== $service['type']) {
                $test = null;
            }
            $services[$index] = array('id' => $services[$index]['id']) + $service + array('test' => $test);
        }
        $this->write($services);

        return array($services[$index], array());
    }

    /**
     * @param string $id the service id
     *
     * @return bool false if it does not exist
     */
    public function delete($id): bool
    {
        $services = $this->all();
        $kept = array_values(array_filter($services, static function ($item) use ($id) {
            return $item['id'] !== $id;
        }));
        if (count($kept) === count($services)) {
            return false;
        }
        $this->write($kept);

        return true;
    }

    /**
     * Keep the result of the last test of a service.
     *
     * @param string $id     the service id
     * @param array  $result the result of checkResponse()
     */
    public function setTest($id, array $result): void
    {
        $services = $this->all();
        foreach ($services as $i => $item) {
            if ($item['id'] === $id) {
                $services[$i]['test'] = self::normalizeTest($result + array('date' => gmdate('Y-m-d H:i')));
                $this->write($services);

                return;
            }
        }
    }

    /**
     * Services offered to a user.
     *
     * @param null|string $login  the login, null for an anonymous user
     * @param string[]    $groups the groups of the user
     *
     * @return list<array{id: string, type: string, url: string, title: string, description: string}> the services
     */
    public function forUser($login, array $groups): array
    {
        $services = array();
        foreach ($this->all() as $service) {
            if (!self::isAllowed($service, $login, $groups)) {
                continue;
            }
            $services[] = array(
                'id' => $service['id'],
                'type' => $service['type'],
                'url' => $service['url'],
                'title' => $service['title'],
                'description' => $service['description'],
            );
        }

        return $services;
    }

    /**
     * Can a user use a service.
     *
     * @param array       $service the service
     * @param null|string $login   the login, null for an anonymous user
     * @param string[]    $groups  the groups of the user
     */
    public static function isAllowed(array $service, $login, array $groups): bool
    {
        if ($service['access'] === 'all') {
            return true;
        }
        if ($login === null || $login === '') {
            return false;
        }
        if ($service['access'] === 'connected') {
            return true;
        }

        return in_array($login, $service['users'], true)
            || count(array_intersect($groups, $service['groups'])) > 0;
    }

    /**
     * Check a service given by the administrator.
     *
     * @param array $data the service
     *
     * @return array{0: null|array, 1: string[]} the service, or the invalid fields
     */
    public static function normalize(array $data): array
    {
        $errors = array();
        $service = UserImports::normalizeService($data['type'] ?? '', $data['url'] ?? '', $data['title'] ?? '');
        if ($service === null) {
            $type = (string) ($data['type'] ?? '');
            $errors[] = in_array($type, UserImports::SERVICE_TYPES, true) ? 'url' : 'type';
        }
        $description = trim(strip_tags((string) ($data['description'] ?? '')));
        if (mb_strlen($description) > 1000) {
            $errors[] = 'description';
        }
        $access = (string) ($data['access'] ?? 'all');
        if (!in_array($access, self::ACCESS, true)) {
            $errors[] = 'access';
        }
        $groups = self::names($data['groups'] ?? array(), '/^[\w.@-]{1,150}$/u');
        $users = self::names($data['users'] ?? array(), '/^[^\s,;<>"\']{1,150}$/u');
        if ($groups === null) {
            $errors[] = 'groups';
        }
        if ($users === null) {
            $errors[] = 'users';
        }
        if (!$errors && $access === 'restricted' && !$groups && !$users) {
            $errors[] = 'groups';
        }
        if ($errors) {
            return array(null, $errors);
        }

        return array($service + array(
            'description' => $description,
            'access' => $access,
            'groups' => $access === 'restricted' ? $groups : array(),
            'users' => $access === 'restricted' ? $users : array(),
        ), array());
    }

    /**
     * Group ids or logins: a list, or a text separated by commas or lines.
     *
     * @param mixed  $value   the names
     * @param string $pattern the valid names
     *
     * @return null|string[] the names without duplicates, null if one is not valid
     */
    protected static function names($value, $pattern): ?array
    {
        if (is_string($value)) {
            $value = preg_split('/[\s,;]+/', $value);
        }
        if (!is_array($value)) {
            return null;
        }
        $names = array();
        foreach ($value as $name) {
            $name = trim((string) $name);
            if ($name === '') {
                continue;
            }
            if (!preg_match($pattern, $name)) {
                return null;
            }
            $names[$name] = true;
        }
        if (count($names) > self::MAX_MEMBERS) {
            return null;
        }

        return array_keys($names);
    }

    /**
     * @param mixed $test the saved test
     *
     * @return null|array{ok: bool, message: string, date: string} the test
     */
    protected static function normalizeTest($test): ?array
    {
        if (!is_array($test) || !isset($test['ok'])) {
            return null;
        }

        $layers = array();
        foreach (array_slice(is_array($test['layers'] ?? null) ? $test['layers'] : array(), 0, self::MAX_TEST_ITEMS) as $layer) {
            if (is_scalar($layer) && trim((string) $layer) !== '') {
                $layers[] = mb_substr(strip_tags((string) $layer), 0, 200);
            }
        }
        $services = array();
        foreach (array_slice(is_array($test['services'] ?? null) ? $test['services'] : array(), 0, self::MAX_TEST_ITEMS) as $item) {
            $service = is_array($item) ? UserImports::normalizeService('arcgis', $item['url'] ?? '', $item['title'] ?? '') : null;
            if ($service) {
                $services[] = array('url' => $service['url'], 'title' => $service['title'],
                    'kind' => in_array($item['kind'] ?? '', array('FeatureServer', 'MapServer'), true) ? $item['kind'] : '');
            }
        }

        return array(
            'ok' => (bool) $test['ok'],
            'message' => mb_substr(strip_tags((string) ($test['message'] ?? '')), 0, 300),
            'date' => preg_match('/^\d{4}-\d\d-\d\d \d\d:\d\d$/', (string) ($test['date'] ?? '')) ? $test['date'] : '',
            'layers' => $layers,
            'services' => $services,
        );
    }

    /**
     * Address requested to test a service, like the data catalog reads it.
     *
     * @param string $type the service type
     * @param string $url  the service address
     *
     * @return string the address
     */
    public static function testUrl($type, $url): string
    {
        $base = self::baseUrl($url);
        switch ($type) {
            case 'wms':
            case 'wmts':
            case 'wfs':
                return self::withParams($base, array('SERVICE' => strtoupper($type), 'REQUEST' => 'GetCapabilities'));

            case 'ogcapi':
                return self::withParams(preg_replace('#/collections/?$#', '', $base).'/collections', array('f' => 'json'));

            case 'arcgis':
                return self::withParams($base, array('f' => 'json'));

            case 'xyz':
                return str_replace(array('{z}', '{x}', '{y}', '{-y}', '{s}'), array('0', '0', '0', '0', 'a'), trim($url));

            default:
                return trim($url);
        }
    }

    /**
     * Result of the test of a service.
     *
     * @param string $type        the service type
     * @param int    $code        the HTTP code
     * @param string $contentType the content type
     * @param string $body        the response
     * @param string $url         the service address, to give the services of an ArcGIS directory
     *
     * @return array{ok: bool, message: string, layers?: string[], services?: list<array>, folders?: string[]} the result,
     *                                                                                                       with the layers, or the services and folders of an ArcGIS directory
     */
    public static function checkResponse($type, $code, $contentType, $body, $url = ''): array
    {
        if ($code < 200 || $code >= 300) {
            return array('ok' => false, 'message' => 'HTTP '.$code);
        }
        $body = (string) $body;
        switch ($type) {
            case 'wms':
            case 'wmts':
            case 'wfs':
                if (preg_match('/<(\w+:)?(ServiceExceptionReport|ExceptionReport)\b/', $body)
                    || !preg_match('/<(\w+:)?(WMS_Capabilities|WMT_MS_Capabilities|WFS_Capabilities|Capabilities)\b/', $body)) {
                    return array('ok' => false, 'message' => 'No capabilities');
                }
                $patterns = array(
                    'wms' => '#<Layer\b[^>]*>\s*<Name>([^<]+)</Name>(?:\s*<Title>([^<]*)</Title>)?#',
                    'wmts' => '#<Layer>.*?<ows:Title>([^<]*)</ows:Title>.*?<ows:Identifier>([^<]+)</ows:Identifier>#s',
                    'wfs' => '#<(?:\w+:)?FeatureType\b[^>]*>\s*<(?:\w+:)?Name>([^<]+)</(?:\w+:)?Name>(?:\s*<(?:\w+:)?Title>([^<]*)<)?#',
                );
                preg_match_all($patterns[$type], $body, $matches, PREG_SET_ORDER);
                $names = array();
                foreach ($matches as $match) {
                    $name = $type === 'wmts' ? $match[2] : $match[1];
                    $title = $type === 'wmts' ? $match[1] : ($match[2] ?? '');
                    $names[] = html_entity_decode(trim($title) !== '' && trim($title) !== trim($name) ? trim($title).' ('.trim($name).')' : trim($name), ENT_QUOTES | ENT_XML1);
                }

                return self::layers($names);

            case 'ogcapi':
                $data = json_decode($body, true);
                if (!is_array($data) || !isset($data['collections']) || !is_array($data['collections'])) {
                    return array('ok' => false, 'message' => 'No collections');
                }

                return self::layers(array_map(static function ($item) {
                    return is_array($item) ? (string) ($item['title'] ?? ($item['id'] ?? '')) : '';
                }, $data['collections']));

            case 'arcgis':
                $data = json_decode($body, true);
                if (!is_array($data) || isset($data['error'])) {
                    return array('ok' => false, 'message' => is_array($data) ? (string) ($data['error']['message'] ?? 'Error') : 'No JSON');
                }

                if (is_array($data['layers'] ?? null) && count($data['layers'])) {
                    return self::layers(array_map(static function ($item) {
                        return is_array($item) ? (string) ($item['name'] ?? ($item['id'] ?? '')) : '';
                    }, $data['layers']));
                }
                // A directory of services, like .../ArcGIS/rest/services
                if (is_array($data['services'] ?? null) || is_array($data['folders'] ?? null)) {
                    $services = self::arcgisServices($data, $url);
                    $folders = array_values(array_filter(array_map('strval', is_array($data['folders'] ?? null) ? $data['folders'] : array())));

                    return array(
                        'ok' => false,
                        'message' => 'Directory: '.count($services).' service(s)'.($folders ? ', '.count($folders).' folder(s)' : ''),
                        'services' => $services,
                        'folders' => $folders,
                    );
                }

                return array('ok' => false, 'message' => 'No layer');

            case 'xyz':
                return stripos($contentType, 'image/') === 0
                    ? array('ok' => true, 'message' => 'OK')
                    : array('ok' => false, 'message' => 'No image');

            case 'geojson':
                $data = json_decode($body, true);
                if (!is_array($data) || !in_array($data['type'] ?? '', array('FeatureCollection', 'Feature'), true)) {
                    return array('ok' => false, 'message' => 'No GeoJSON');
                }

                return self::layers(array(is_array($data['features'] ?? null) ? count($data['features']).' feature(s)' : 'GeoJSON'));
        }

        return array('ok' => false, 'message' => 'Unknown type');
    }

    /**
     * @param string[] $names the layers
     *
     * @return array{ok: bool, message: string, layers: string[]} the result
     */
    protected static function layers(array $names): array
    {
        $names = array_values(array_filter(array_map('trim', array_map('strval', $names)), 'strlen'));

        return $names
            ? array('ok' => true, 'message' => 'OK, '.count($names).' layer(s)', 'layers' => array_slice($names, 0, self::MAX_TEST_ITEMS))
            : array('ok' => false, 'message' => 'No layer', 'layers' => array());
    }

    /**
     * Map and feature services of an ArcGIS directory.
     *
     * @param array  $data the directory, read with f=json
     * @param string $url  the address of the directory, or of one of its folders
     *
     * @return list<array{url: string, title: string, kind: string}> the services
     */
    public static function arcgisServices(array $data, $url): array
    {
        // The names of the services of a folder start with the folder: build them from the root
        $root = preg_replace('#(/rest/services)(/.*)?$#i', '$1', self::baseUrl($url));
        $root = rtrim(explode('?', $root, 2)[0], '/');
        $services = array();
        foreach (is_array($data['services'] ?? null) ? $data['services'] : array() as $item) {
            if (!is_array($item) || !in_array($item['type'] ?? '', array('FeatureServer', 'MapServer'), true)
                || !preg_match('#^[\w./ -]{1,200}$#u', (string) ($item['name'] ?? ''))) {
                continue;
            }
            $name = (string) $item['name'];
            $services[] = array(
                'url' => $root.'/'.str_replace('%2F', '/', rawurlencode($name)).'/'.$item['type'],
                'title' => str_replace('_', ' ', basename($name)),
                'kind' => $item['type'],
            );
        }

        return $services;
    }

    /**
     * Address of a folder of an ArcGIS directory.
     *
     * @param string $url    the address of the directory
     * @param string $folder the folder
     *
     * @return null|string the address, null if the folder name is not valid
     */
    public static function arcgisFolderUrl($url, $folder): ?string
    {
        if (!preg_match('#^[\w. -]{1,200}$#u', $folder)) {
            return null;
        }
        $root = preg_replace('#(/rest/services)(/.*)?$#i', '$1', self::baseUrl($url));

        return self::withParams(rtrim(explode('?', $root, 2)[0], '/').'/'.rawurlencode($folder), array('f' => 'json'));
    }

    /**
     * Address without the OGC request parameters.
     *
     * @param string $url the address
     *
     * @return string the address
     */
    protected static function baseUrl($url): string
    {
        $url = trim($url);
        $parts = explode('?', $url, 2);
        if (count($parts) < 2) {
            return $url;
        }
        $kept = array();
        foreach (explode('&', $parts[1]) as $pair) {
            $key = strtolower(urldecode(explode('=', $pair, 2)[0]));
            if ($pair !== '' && !in_array($key, array('service', 'request', 'version', 'f'), true)) {
                $kept[] = $pair;
            }
        }

        return $parts[0].($kept ? '?'.implode('&', $kept) : '');
    }

    /**
     * Add parameters to an address, replacing the existing ones.
     *
     * @param string $url    the address
     * @param array  $params the parameters
     *
     * @return string the address
     */
    protected static function withParams($url, array $params): string
    {
        $parts = explode('?', $url, 2);
        $keys = array_map('strtolower', array_keys($params));
        $kept = array();
        foreach (count($parts) > 1 ? explode('&', $parts[1]) : array() as $pair) {
            if ($pair !== '' && !in_array(strtolower(urldecode(explode('=', $pair, 2)[0])), $keys, true)) {
                $kept[] = $pair;
            }
        }

        return $parts[0].'?'.implode('&', array_merge($kept, array(http_build_query($params))));
    }

    /**
     * @param list<array> $services the services
     */
    protected function write(array $services): void
    {
        $dir = dirname($this->path);
        if (!is_dir($dir)) {
            mkdir($dir, 0750, true);
        }
        $tmp = $this->path.'.'.bin2hex(random_bytes(4)).'.tmp';
        file_put_contents($tmp, json_encode(array('services' => array_values($services)), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
        @chmod($tmp, 0640);
        rename($tmp, $this->path);
    }
}
