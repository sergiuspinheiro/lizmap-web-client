<?php

/**
 * Find the features of a layer having an attribute value, and compute their extent.
 *
 * Used to zoom to the features named by the AI assistant (e.g. "Lapa Furada").
 * Only the number of features and their extent are given back, never their attributes.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Ai;

class FeatureLocator
{
    /** @var string the searched value, normalized */
    protected $needle;

    /** @var array{count: int, extent: null|array} features having the value */
    protected $exact = array('count' => 0, 'extent' => null);

    /** @var array{count: int, extent: null|array} features having a value containing the searched value */
    protected $partial = array('count' => 0, 'extent' => null);

    /** @var int number of features read */
    protected $read = 0;

    /**
     * @param string $value the searched value
     */
    public function __construct($value)
    {
        $this->needle = self::normalize($value);
    }

    /**
     * Normalize a text: lower case, without accents nor repeated spaces.
     *
     * @param string $text the text
     *
     * @return string the normalized text
     */
    public static function normalize($text)
    {
        $text = mb_strtolower(trim((string) $text));
        if (function_exists('iconv')) {
            $ascii = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
            if ($ascii !== false) {
                $text = $ascii;
            }
        }

        return trim(preg_replace('/[^a-z0-9]+/', ' ', $text));
    }

    /**
     * Read GeoJSON features.
     *
     * @param iterable $features GeoJSON features (arrays or objects)
     * @param int      $limit    maximum number of features read
     */
    public function addFeatures($features, $limit = 10000)
    {
        foreach ($features as $feature) {
            if ($this->read >= $limit) {
                break;
            }
            $this->add($feature);
        }
    }

    /**
     * Read a GeoJSON feature.
     *
     * @param array|object $feature the feature
     */
    public function add($feature)
    {
        ++$this->read;
        if ($this->needle === '') {
            return;
        }
        $feature = json_decode(json_encode($feature), true);
        if (!is_array($feature) || empty($feature['geometry']['coordinates'])) {
            return;
        }
        $match = null;
        foreach ((array) ($feature['properties'] ?? array()) as $value) {
            if (!is_scalar($value) || is_bool($value)) {
                continue;
            }
            $value = self::normalize($value);
            if ($value === $this->needle) {
                $match = 'exact';

                break;
            }
            if (strlen($this->needle) >= 3 && str_contains($value, $this->needle)) {
                $match = 'partial';
            }
        }
        if ($match === null) {
            return;
        }
        $found = &$this->{$match};
        ++$found['count'];
        $found['extent'] = self::extend($found['extent'], $feature['geometry']['coordinates']);
        unset($found);
    }

    /**
     * The features found: the ones having the value, or else the ones containing it.
     *
     * @return array{count: int, extent: null|array, exact: bool, read: int}
     */
    public function toArray()
    {
        $found = $this->exact['count'] > 0 ? $this->exact : $this->partial;

        return array(
            'count' => $found['count'],
            'extent' => $found['extent'],
            'exact' => $this->exact['count'] > 0,
            'read' => $this->read,
        );
    }

    /**
     * Extend an extent with the positions of GeoJSON coordinates.
     *
     * @param null|array $extent      the extent [xmin, ymin, xmax, ymax]
     * @param array      $coordinates the coordinates, at any depth
     *
     * @return null|array the extent
     */
    protected static function extend($extent, $coordinates)
    {
        if (!is_array($coordinates)) {
            return $extent;
        }
        if (count($coordinates) >= 2 && is_numeric($coordinates[0] ?? null) && is_numeric($coordinates[1] ?? null)) {
            $x = (float) $coordinates[0];
            $y = (float) $coordinates[1];
            if ($extent === null) {
                return array($x, $y, $x, $y);
            }

            return array(min($extent[0], $x), min($extent[1], $y), max($extent[2], $x), max($extent[3], $y));
        }
        foreach ($coordinates as $position) {
            $extent = self::extend($extent, $position);
        }

        return $extent;
    }
}
