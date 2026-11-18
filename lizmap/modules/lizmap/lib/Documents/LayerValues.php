<?php

/**
 * The fields of a layer and their distinct values, to link documents to
 * the features having a value.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Documents;

class LayerValues
{
    /** @var int maximum number of distinct values by field */
    protected $maxValues;

    /** @var int values longer than this length are not kept */
    protected $maxValueLength;

    /** @var array<string, array<string, int>> number of features by value, by field */
    protected $values = array();

    /** @var array<string, bool> fields having more distinct values than kept */
    protected $truncated = array();

    /** @var int number of features read */
    protected $read = 0;

    /**
     * @param int $maxValues      maximum number of distinct values by field
     * @param int $maxValueLength values longer than this length are not kept
     */
    public function __construct($maxValues = 500, $maxValueLength = 200)
    {
        $this->maxValues = max(1, (int) $maxValues);
        $this->maxValueLength = max(1, (int) $maxValueLength);
    }

    /**
     * Read the properties of a feature.
     *
     * @param array|object $properties the properties
     */
    public function add($properties)
    {
        ++$this->read;
        foreach ((array) $properties as $name => $value) {
            $name = (string) $name;
            if (!array_key_exists($name, $this->values)) {
                $this->values[$name] = array();
            }
            if (!is_scalar($value) || is_bool($value)) {
                continue;
            }
            $value = trim((string) $value);
            if ($value === '' || mb_strlen($value) > $this->maxValueLength) {
                continue;
            }
            if (array_key_exists($value, $this->values[$name])) {
                ++$this->values[$name][$value];
            } elseif (count($this->values[$name]) < $this->maxValues) {
                $this->values[$name][$value] = 1;
            } else {
                $this->truncated[$name] = true;
            }
        }
    }

    /**
     * Read GeoJSON features.
     *
     * @param iterable $features the features (arrays or objects)
     * @param int      $limit    maximum number of features read
     */
    public function addFeatures($features, $limit = 5000)
    {
        foreach ($features as $feature) {
            if ($this->read >= $limit) {
                break;
            }
            $feature = json_decode(json_encode($feature), true);
            $this->add(is_array($feature) ? ($feature['properties'] ?? array()) : array());
        }
    }

    /**
     * The fields, and their values sorted in natural order.
     *
     * @return array{fields: list<array{name: string, values: list<string>, truncated: bool}>, read: int}
     */
    public function toArray()
    {
        $fields = array();
        foreach ($this->values as $name => $counts) {
            $values = array_map('strval', array_keys($counts));
            natcasesort($values);
            $fields[] = array(
                'name' => $name,
                'values' => array_values($values),
                'truncated' => !empty($this->truncated[$name]),
            );
        }

        return array('fields' => $fields, 'read' => $this->read);
    }
}
