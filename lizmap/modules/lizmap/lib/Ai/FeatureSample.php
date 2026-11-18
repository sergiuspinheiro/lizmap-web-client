<?php

/**
 * A sample of the features of a layer, as a compact table for the AI assistant.
 *
 * Only used when the administrator allows sending the features, e.g. with a
 * local model: the features sharing words with the question come first, then
 * the first features of the layer, within a size limit.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Ai;

class FeatureSample
{
    /** @var array<string, true> word stems of the question */
    protected $stems;

    /** @var int maximum number of rows */
    protected $maxRows;

    /** @var int maximum length of the table text */
    protected $maxLength;

    /** @var int maximum length of a value */
    protected $maxValueLength;

    /** @var array<string, true> column names */
    protected $columns = array();

    /** @var list<array> rows sharing words with the question */
    protected $matched = array();

    /** @var list<array> other rows */
    protected $others = array();

    /** @var int number of features read */
    protected $read = 0;

    /** @var int number of features sharing words with the question */
    protected $matchedCount = 0;

    /**
     * @param string $question       the user question
     * @param int    $maxRows        maximum number of rows
     * @param int    $maxLength      maximum length of the table text, so that it fits the model context
     * @param int    $maxValueLength values are cut to this length
     */
    public function __construct($question, $maxRows = 100, $maxLength = 12000, $maxValueLength = 60)
    {
        $this->stems = Assistant::stems($question);
        $this->maxRows = max(1, (int) $maxRows);
        $this->maxLength = $maxLength;
        $this->maxValueLength = $maxValueLength;
    }

    /**
     * Read a GeoJSON feature.
     *
     * @param array|object $feature the feature, in EPSG:4326
     */
    public function add($feature)
    {
        ++$this->read;
        $feature = json_decode(json_encode($feature), true);
        if (!is_array($feature)) {
            return;
        }
        $row = array();
        foreach ((array) ($feature['properties'] ?? array()) as $name => $value) {
            if (is_bool($value)) {
                $value = $value ? 'true' : 'false';
            } elseif (!is_scalar($value)) {
                $value = $value === null ? '' : json_encode($value, JSON_UNESCAPED_UNICODE);
            }
            $value = trim(preg_replace('/\s+/u', ' ', (string) $value));
            if (mb_strlen($value) > $this->maxValueLength) {
                $value = mb_substr($value, 0, $this->maxValueLength).'…';
            }
            $row[(string) $name] = $value;
        }
        $center = self::center($feature['geometry']['coordinates'] ?? null);
        if ($center !== null) {
            $row['lon'] = (string) round($center[0], 5);
            $row['lat'] = (string) round($center[1], 5);
        }
        if (count($row) === 0) {
            return;
        }

        $matches = $this->stems && array_intersect_key($this->stems, Assistant::stems(implode(' ', $row)));
        if ($matches) {
            ++$this->matchedCount;
        }
        $list = $matches ? 'matched' : 'others';
        if (count($this->{$list}) < $this->maxRows) {
            $this->{$list}[] = $row;
            $this->columns += array_fill_keys(array_keys($row), true);
        }
    }

    /**
     * Read GeoJSON features.
     *
     * @param iterable $features the features
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
     * @return int number of features read
     */
    public function count()
    {
        return $this->read;
    }

    /**
     * The sample, as a table: one line by feature, values separated by " | ".
     *
     * @return array{columns: list<string>, table: string, rows: int, matched: int, read: int}
     */
    public function toArray()
    {
        $columns = array_keys($this->columns);
        $lines = array(implode(' | ', $columns));
        $length = mb_strlen($lines[0]);
        $rows = 0;
        foreach (array_merge($this->matched, $this->others) as $row) {
            if ($rows >= $this->maxRows) {
                break;
            }
            $values = array();
            foreach ($columns as $column) {
                $values[] = str_replace('|', '/', $row[$column] ?? '');
            }
            $line = implode(' | ', $values);
            if ($length + mb_strlen($line) + 1 > $this->maxLength) {
                break;
            }
            $lines[] = $line;
            $length += mb_strlen($line) + 1;
            ++$rows;
        }

        return array(
            'columns' => $columns,
            'table' => $rows > 0 ? implode("\n", $lines) : '',
            'rows' => $rows,
            'matched' => $this->matchedCount,
            'read' => $this->read,
        );
    }

    /**
     * Center of the extent of GeoJSON coordinates.
     *
     * @param mixed $coordinates the coordinates, at any depth
     *
     * @return null|array{0: float, 1: float}
     */
    protected static function center($coordinates)
    {
        $extent = null;
        $walk = static function ($coordinates) use (&$walk, &$extent) {
            if (!is_array($coordinates)) {
                return;
            }
            if (count($coordinates) >= 2 && is_numeric($coordinates[0] ?? null) && is_numeric($coordinates[1] ?? null)) {
                $x = (float) $coordinates[0];
                $y = (float) $coordinates[1];
                $extent = $extent === null ? array($x, $y, $x, $y)
                    : array(min($extent[0], $x), min($extent[1], $y), max($extent[2], $x), max($extent[3], $y));

                return;
            }
            foreach ($coordinates as $position) {
                $walk($position);
            }
        };
        $walk($coordinates);

        return $extent === null ? null : array(($extent[0] + $extent[2]) / 2, ($extent[1] + $extent[3]) / 2);
    }
}
