<?php

/**
 * The features of a PostgreSQL layer intersecting an area, with the area or
 * the length of their intersection: the overlay analysis.
 *
 * The features are read as a WFS GetFeature request would read them: only
 * the layers published in WFS and visible to the user, with the filters of
 * the layer datasource, the filter by login and the filter by polygon.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Request;

class OverlayRequest extends WFSRequest
{
    /**
     * The area of an analysis: the union of the geometries, each one with a buffer.
     *
     * @param \jDbConnection $cnx        a connection to a PostGIS database
     * @param list<array>    $geometries GeoJSON geometries in EPSG:4326
     * @param float          $buffer     the buffer, in meters
     *
     * @return null|array{geometry: string, area: float, extent: list<float>} the area as GeoJSON in EPSG:4326, its area in m²
     */
    public static function area($cnx, array $geometries, $buffer)
    {
        $json = json_encode(array_values($geometries));
        $buffer = max(0, (float) $buffer);
        $sql = 'SELECT ST_AsGeoJSON(geom, 7) AS geojson, ST_Area(geom::geography) AS area,'
            .' ST_XMin(geom) AS xmin, ST_YMin(geom) AS ymin, ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax'
            .' FROM (SELECT ST_Union(CASE WHEN '.$buffer.' > 0 THEN ST_Buffer(g::geography, '.$buffer.')::geometry ELSE g END) AS geom'
            .' FROM (SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(j), 4326)) AS g'
            .' FROM json_array_elements_text('.$cnx->quote($json).'::json) AS j) AS s) AS u';
        $record = $cnx->query($sql)->fetch();
        if (!$record || !$record->geojson) {
            return null;
        }

        return array(
            'geometry' => $record->geojson,
            'area' => (float) $record->area,
            'extent' => array((float) $record->xmin, (float) $record->ymin, (float) $record->xmax, (float) $record->ymax),
        );
    }

    /**
     * The features of the layer (TYPENAME parameter) intersecting the area.
     *
     * @param array{geometry: string, area: float, extent: list<float>} $area        the area, from area()
     * @param int                                                       $maxFeatures maximum number of features
     *
     * @return array{status: string, fields?: list<array{name: string, alias: string}>, features?: list<array>, truncated?: bool}
     *                                                                                                                            status: ok, forbidden or unsupported (not a PostgreSQL layer)
     */
    public function intersect(array $area, $maxFeatures = 500)
    {
        if ($this->checkingTypename() !== 200) {
            return array('status' => 'forbidden');
        }
        $lizmapLayer = $this->project->findLayerByTypeName($this->requestedTypename());
        if (!$lizmapLayer) {
            return array('status' => 'forbidden');
        }
        $qgisLayer = $this->project->getLayer($lizmapLayer->id);
        if (!$qgisLayer instanceof \qgisVectorLayer || $qgisLayer->getProvider() !== 'postgres') {
            return array('status' => 'unsupported');
        }
        $this->qgisLayer = $qgisLayer;
        $this->datasource = $qgisLayer->getDatasourceParameters();
        if (empty($this->datasource->geocol) || $this->datasource->table[0] === '(') {
            return array('status' => 'unsupported');
        }
        $cnx = $qgisLayer->getDatasourceConnection();
        $params = $this->parameters();
        $params['bbox'] = implode(',', $area['extent']);
        $params['srsname'] = 'EPSG:4326';
        $where = $this->getWhereClause($cnx, $params);
        if ($where === false) {
            return array('status' => 'unsupported');
        }

        // The fields published in WFS, with their alias
        $dbFields = $qgisLayer->getDbFieldList();
        $aliases = $qgisLayer->getAliasFields();
        $fields = array();
        foreach ($qgisLayer->getWfsFields() as $field) {
            if (array_key_exists($field, $dbFields) && $field !== $this->datasource->geocol) {
                $fields[] = array('name' => $field, 'alias' => (string) (($aliases[$field] ?? '') ?: $field));
            }
        }

        $srid = (int) $qgisLayer->getSrid();
        $geocol = $cnx->encloseName($this->datasource->geocol);
        $areaSql = 'ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('.$cnx->quote($area['geometry']).'), 4326), '.$srid.')';
        $select = array_map(static function ($field) use ($cnx) {
            return $cnx->encloseName($field['name']);
        }, $fields);
        $select[] = 'ST_Transform(ST_Intersection(CASE WHEN ST_IsValid('.$geocol.') THEN '.$geocol
            .' ELSE ST_MakeValid('.$geocol.') END, '.$areaSql.'), 4326) AS lizmap_overlay_geom';
        $sql = 'SELECT *, ST_Area(lizmap_overlay_geom::geography) AS lizmap_overlay_area,'
            .' ST_Length(lizmap_overlay_geom::geography) AS lizmap_overlay_length,'
            .' ST_XMin(lizmap_overlay_geom) AS lizmap_xmin, ST_YMin(lizmap_overlay_geom) AS lizmap_ymin,'
            .' ST_XMax(lizmap_overlay_geom) AS lizmap_xmax, ST_YMax(lizmap_overlay_geom) AS lizmap_ymax'
            .' FROM (SELECT '.implode(', ', $select).' FROM '.$this->datasource->table
            .$where.' AND ST_Intersects('.$geocol.', '.$areaSql.')'
            .' LIMIT '.((int) $maxFeatures + 1).') AS lizmap_overlay';

        $features = array();
        $truncated = false;
        foreach ($cnx->query($sql) as $record) {
            if (count($features) >= $maxFeatures) {
                $truncated = true;

                break;
            }
            $properties = array();
            foreach ($fields as $field) {
                $properties[$field['name']] = $record->{$field['name']} ?? null;
            }
            $features[] = self::measures(
                $properties,
                (float) $record->lizmap_overlay_area,
                (float) $record->lizmap_overlay_length,
                $area['area'],
                $record->lizmap_xmin === null ? null : array(
                    (float) $record->lizmap_xmin, (float) $record->lizmap_ymin,
                    (float) $record->lizmap_xmax, (float) $record->lizmap_ymax,
                ),
            );
        }

        return array(
            'status' => 'ok',
            'fields' => $fields,
            'features' => $features,
            'truncated' => $truncated,
        );
    }

    /**
     * WHERE clause of the request, with the datasource, bbox, login and
     * polygon filters, like WFSRequest::getfeaturePostgres() in 3.10.
     *
     * @param \jDbConnection $cnx    The database connection
     * @param array          $params The request parameters
     *
     * @return false|string the clause, false when QGIS Server must be used
     */
    protected function getWhereClause($cnx, $params)
    {
        $sql = ' WHERE True';
        $sql .= $this->getDatasourceSql();
        $sql .= $this->getBboxSql($params);
        // This also include the filter by login, as done in "parameters"
        $expFilterSql = $this->parseExpFilter($cnx, $params);
        if ($expFilterSql === false) {
            return false;
        }
        $sql .= $expFilterSql;
        $polygonFilter = $this->qgisLayer->getPolygonFilter($this->editingContext, 5);
        if ($polygonFilter) {
            $sql .= ' AND ( '.$polygonFilter.' )';
        }
        $sql .= $this->parseFeatureId($cnx, $params);

        return $sql;
    }

    /**
     * A feature intersecting the area, with the measures of the intersection.
     *
     * @param array           $properties the attributes
     * @param float           $area       the area of the intersection, m²
     * @param float           $length     the length of the intersection, m
     * @param float           $total      the area of the analysis, m²
     * @param null|list<float> $extent    the extent of the intersection, EPSG:4326
     *
     * @return array{properties: array, area: null|float, percent: null|float, length: null|float, extent: null|list<float>}
     */
    public static function measures(array $properties, $area, $length, $total, $extent)
    {
        $hasArea = $area > 0;

        return array(
            'properties' => $properties,
            'area' => $hasArea ? round($area, 2) : null,
            // Share of the area of the analysis covered by the feature
            'percent' => $hasArea && $total > 0 ? round(min(100, $area / $total * 100), 2) : null,
            'length' => !$hasArea && $length > 0 ? round($length, 2) : null,
            'extent' => $extent,
        );
    }
}
