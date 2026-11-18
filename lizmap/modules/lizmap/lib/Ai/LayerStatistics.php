<?php

/**
 * Aggregated statistics of the attributes of a layer.
 *
 * Only aggregates are kept (counts, min, max, mean, most frequent values),
 * so that the AI assistant never receives the rows of a layer.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Ai;

class LayerStatistics
{
    /** @var int Number of most frequent values kept for a text field */
    protected $topValues;

    /** @var int Maximum length of a text value sent to the assistant */
    protected $maxValueLength;

    /** @var int A text value is kept only if it is found at least this number of times */
    protected $minTopCount;

    /** @var int Number of features read */
    protected $count = 0;

    /** @var array<string, array> Statistics by field name */
    protected $fields = array();

    /**
     * @param int $topValues      number of most frequent values kept for a text field
     * @param int $maxValueLength text values are cut to this length
     * @param int $minTopCount    a text value is kept only if found at least this number of times,
     *                            so that values of a single feature (names, addresses) are not sent
     */
    public function __construct($topValues = 5, $maxValueLength = 60, $minTopCount = 3)
    {
        $this->topValues = $topValues;
        $this->maxValueLength = $maxValueLength;
        $this->minTopCount = $minTopCount;
    }

    /**
     * Add the properties of a feature.
     *
     * @param array|object $properties the feature properties
     */
    public function add($properties)
    {
        ++$this->count;
        foreach ((array) $properties as $name => $value) {
            $name = (string) $name;
            if (!array_key_exists($name, $this->fields)) {
                $this->fields[$name] = array(
                    'empty' => 0,
                    'numbers' => 0,
                    'texts' => 0,
                    'min' => null,
                    'max' => null,
                    'sum' => 0.0,
                    'values' => array(),
                );
            }
            $field = &$this->fields[$name];
            if ($value === null || $value === '') {
                ++$field['empty'];
            } elseif (is_bool($value)) {
                $this->addText($field, $value ? 'true' : 'false');
            } elseif (is_int($value) || is_float($value)) {
                ++$field['numbers'];
                $number = (float) $value;
                $field['min'] = $field['min'] === null ? $number : min($field['min'], $number);
                $field['max'] = $field['max'] === null ? $number : max($field['max'], $number);
                $field['sum'] += $number;
            } elseif (is_scalar($value)) {
                $this->addText($field, (string) $value);
            } else {
                // Arrays and objects (JSON fields): only counted
                $this->addText($field, '[json]');
            }
            unset($field);
        }
    }

    /**
     * Add every feature of an iterable of GeoJSON features.
     *
     * @param iterable $features GeoJSON features (arrays or objects)
     * @param int      $limit    maximum number of features read
     */
    public function addFeatures($features, $limit = 1000)
    {
        foreach ($features as $feature) {
            if ($this->count >= $limit) {
                break;
            }
            $feature = (array) $feature;
            $this->add(array_key_exists('properties', $feature) && $feature['properties'] !== null ? $feature['properties'] : array());
        }
    }

    /**
     * @return int number of features read
     */
    public function count()
    {
        return $this->count;
    }

    /**
     * The aggregated statistics.
     *
     * @return array{features: int, fields: list<array>}
     */
    public function toArray()
    {
        $fields = array();
        foreach ($this->fields as $name => $field) {
            $filled = $this->count - $field['empty'];
            $stats = array(
                'name' => $name,
                'filled' => $filled,
                'empty' => $this->count - $filled,
            );
            if ($field['numbers'] > 0 && $field['numbers'] >= $field['texts']) {
                $stats['type'] = 'number';
                $stats['min'] = $field['min'];
                $stats['max'] = $field['max'];
                $stats['mean'] = round($field['sum'] / $field['numbers'], 4);
            } elseif ($field['texts'] > 0) {
                $stats['type'] = 'text';
                $stats['distinct'] = count($field['values']);
                arsort($field['values']);
                $top = array();
                foreach (array_slice($field['values'], 0, $this->topValues, true) as $value => $count) {
                    if ($count < $this->minTopCount) {
                        break;
                    }
                    $top[] = array('value' => (string) $value, 'count' => $count);
                }
                $stats['top'] = $top;
            } else {
                $stats['type'] = 'empty';
            }
            $fields[] = $stats;
        }

        return array(
            'features' => $this->count,
            'fields' => $fields,
        );
    }

    /**
     * Count a text value.
     *
     * @param array  $field the field statistics
     * @param string $value the value
     */
    protected function addText(array &$field, $value)
    {
        ++$field['texts'];
        if (mb_strlen($value) > $this->maxValueLength) {
            $value = mb_substr($value, 0, $this->maxValueLength).'…';
        }
        // Keep the memory bounded on fields with many distinct values
        if (!array_key_exists($value, $field['values']) && count($field['values']) >= 1000) {
            return;
        }
        $field['values'][$value] = ($field['values'][$value] ?? 0) + 1;
    }
}
