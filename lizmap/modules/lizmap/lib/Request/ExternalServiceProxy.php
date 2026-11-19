<?php

/**
 * Reads the capabilities and the features of an external service for the browser,
 * when the service does not allow requests from the Lizmap site (CORS).
 *
 * Only public addresses are read, never the QGIS Server of Lizmap nor
 * a host of the local network, and redirections are checked the same way.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Request;

class ExternalServiceProxy
{
    /** Maximum size of an answer, in bytes */
    public const MAX_SIZE = 50 * 1024 * 1024;

    /** Maximum number of redirections followed */
    public const MAX_REDIRECTS = 5;

    /**
     * @var null|callable resolves a host name into its IP addresses, for the tests
     */
    protected $resolver;

    /**
     * @var string URL of the QGIS Server used by Lizmap
     */
    protected $qgisServerUrl;

    /**
     * @param string        $qgisServerUrl URL of the QGIS Server used by Lizmap, never read
     * @param null|callable $resolver      resolves a host name into its IP addresses
     */
    public function __construct($qgisServerUrl = '', $resolver = null)
    {
        $this->qgisServerUrl = (string) $qgisServerUrl;
        $this->resolver = $resolver;
    }

    /**
     * Check that an URL can be read: http or https, a public host, not the QGIS Server.
     *
     * @param string $url the URL
     *
     * @return null|string the reason why the URL can not be read, null if it can
     */
    public function refusal($url)
    {
        return $this->check($url)[0];
    }

    /**
     * Check an URL and give the IP addresses checked for its host.
     *
     * @param string $url the URL
     *
     * @return array{0: null|string, 1: list<string>} the reason why the URL can not be read (null if it can)
     *                                                and the public IP addresses of its host
     */
    protected function check($url)
    {
        $refusal = $this->checkUrl($url, $ips);

        return array($refusal, $refusal === null ? $ips : array());
    }

    /**
     * @param string       $url the URL
     * @param list<string> $ips the IP addresses of the host, set by the check
     *
     * @return null|string the reason why the URL can not be read, null if it can
     */
    protected function checkUrl($url, &$ips)
    {
        $ips = array();
        $parts = parse_url($url);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) {
            return 'Invalid URL';
        }
        if (!in_array(strtolower($parts['scheme']), array('http', 'https'), true)) {
            return 'Only http and https URLs can be read';
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            return 'URLs with credentials can not be read';
        }
        if ($this->qgisServerUrl !== '' && stripos($url, $this->qgisServerUrl) === 0) {
            return 'The QGIS Server can not be read this way';
        }

        $host = strtolower(trim($parts['host'], '[]'));
        if ($host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local')
            || str_ends_with($host, '.internal')) {
            return 'Local hosts can not be read';
        }

        $ips = filter_var($host, FILTER_VALIDATE_IP) !== false ? array($host) : $this->resolve($host);
        if (!count($ips)) {
            return 'Unknown host '.$host;
        }
        foreach ($ips as $ip) {
            if (!self::isPublicIp($ip)) {
                return 'Hosts of the local network can not be read';
            }
        }

        return null;
    }

    /**
     * Is an IP address public.
     *
     * @param string $ip the IP address
     *
     * @return bool
     */
    public static function isPublicIp($ip)
    {
        // IPv4 mapped in IPv6, like ::ffff:127.0.0.1
        if (preg_match('/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i', $ip, $matches)) {
            $ip = $matches[1];
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return false;
        }
        // Ranges not filtered by every PHP version: shared address space,
        // IPv6 unique local and link local addresses
        if (preg_match('/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./', $ip)
            || preg_match('/^0\./', $ip)
            || preg_match('/^(fc|fd|fe[89ab])/i', $ip)
            || $ip === '::' || $ip === '::1') {
            return false;
        }

        return true;
    }

    /**
     * IP addresses of a host.
     *
     * @param string $host the host name
     *
     * @return list<string>
     */
    protected function resolve($host)
    {
        if ($this->resolver) {
            return call_user_func($this->resolver, $host);
        }
        $ips = gethostbynamel($host) ?: array();
        $records = @dns_get_record($host, DNS_AAAA) ?: array();
        foreach ($records as $record) {
            if (isset($record['ipv6'])) {
                $ips[] = $record['ipv6'];
            }
        }

        return array_values(array_unique($ips));
    }

    /**
     * Read an URL, following the allowed redirections.
     *
     * @param string $url the URL
     *
     * @return array{0: int, 1: string, 2: string} the HTTP code, the content type and the body
     *
     * @throws \InvalidArgumentException when the URL, or a redirection, can not be read
     */
    public function read($url)
    {
        for ($i = 0; $i <= self::MAX_REDIRECTS; ++$i) {
            list($refusal, $ips) = $this->check($url);
            if ($refusal !== null) {
                throw new \InvalidArgumentException($refusal);
            }
            $this->checkedIps = $ips;
            $options = array(
                'method' => 'GET',
                'allow_redirects' => false,
            );
            $pin = $this->pin($url);
            if ($pin !== null) {
                // Connect to the address checked, not to a new answer of the DNS
                $options['curl'] = array(CURLOPT_RESOLVE => array($pin));
            }
            $response = Proxy::getRemoteDataAsStream($url, $options);
            $code = $response->getCode();
            if (in_array($code, array(301, 302, 303, 307, 308), true)) {
                $location = self::header($response->getHeaders(), 'Location');
                $response->getBodyAsStream()->close();
                if ($location === '') {
                    break;
                }
                $url = self::absoluteUrl($location, $url);

                continue;
            }

            return array($code, $response->getMime(), self::readLimited($response->getBodyAsStream()));
        }

        throw new \InvalidArgumentException('Too many redirections');
    }

    /**
     * @var list<string> IP addresses checked for the URL being read
     */
    protected $checkedIps = array();

    /**
     * The CURLOPT_RESOLVE entry connecting to the first IP address checked.
     *
     * @param string $url the URL
     *
     * @return null|string the entry, null for an IP address in the URL
     */
    protected function pin($url)
    {
        $parts = parse_url($url);
        $host = trim($parts['host'] ?? '', '[]');
        if ($host === '' || filter_var($host, FILTER_VALIDATE_IP) !== false || !count($this->checkedIps)) {
            return null;
        }
        $port = $parts['port'] ?? (strtolower($parts['scheme']) === 'https' ? 443 : 80);
        $ip = $this->checkedIps[0];
        if (str_contains($ip, ':')) {
            $ip = '['.$ip.']';
        }

        return $host.':'.$port.':'.$ip;
    }

    /**
     * Read a stream, without going over the maximum size.
     *
     * @param \Psr\Http\Message\StreamInterface $stream the stream
     * @param int                               $max    the maximum size, in bytes
     *
     * @return string the content
     *
     * @throws \InvalidArgumentException when the content is too big
     */
    public static function readLimited($stream, $max = self::MAX_SIZE)
    {
        $body = '';
        while (!$stream->eof()) {
            $body .= $stream->read(65536);
            if (strlen($body) > $max) {
                $stream->close();

                throw new \InvalidArgumentException('The answer of the service is too big');
            }
        }
        $stream->close();

        return $body;
    }

    /**
     * Value of a response header.
     *
     * @param array<string, array<string>|string> $headers the headers
     * @param string                              $name    the header name
     *
     * @return string the first value, empty if none
     */
    protected static function header(array $headers, $name)
    {
        foreach ($headers as $key => $value) {
            if (strcasecmp($key, $name) === 0) {
                return trim(is_array($value) ? (string) ($value[0] ?? '') : (string) $value);
            }
        }

        return '';
    }

    /**
     * Absolute URL of a redirection.
     *
     * @param string $location the Location header
     * @param string $base     the URL redirected
     *
     * @return string
     */
    public static function absoluteUrl($location, $base)
    {
        if (preg_match('#^[a-z][a-z0-9+.-]*://#i', $location)) {
            return $location;
        }
        $parts = parse_url($base);
        $origin = $parts['scheme'].'://'.$parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');
        if (str_starts_with($location, '//')) {
            return $parts['scheme'].':'.$location;
        }
        if (str_starts_with($location, '/')) {
            return $origin.$location;
        }
        $path = $parts['path'] ?? '/';

        return $origin.substr($path, 0, strrpos($path, '/') + 1).$location;
    }
}
