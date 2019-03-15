<?php
/**
* Manage and give access to lizmap configuration.
* @package   lizmap
* @subpackage filter
* @author    3liz
* @copyright 2017 3liz
* @link      http://3liz.com
* @license Mozilla Public License : http://www.mozilla.org/MPL/
*/

class filterDatasource {

    protected $provider = 'postgres';
    private $status = false;
    private $errors = array();
    private $repository = null;
    private $project = null;
    private $layerId = null;
    private $layername = null;
    private $layer = null;
    private $datasource = null;
    private $cnx = null;
    private $lproj = null;
    private $config = null;
    private $data = null;

    protected $blackSqlWords = array(
        ';',
        'select',
        'delete',
        'insert',
        'update',
        'drop',
        'alter',
        '--',
        'truncate',
        'vacuum',
        'create'
    );


    function __construct( $repository, $project, $layerId ){

        // Check filter config
        jClasses::inc('filter~filterConfig');
        $dv = new filterConfig($repository, $project);
        if(!$dv->getStatus()){
            return $this->error($dv->getErrors());
        }
        $config = $dv->getConfig();
        if( empty($config) ){
            return $this->error($dv->getErrors());
        }

        $this->repository = $repository;
        $this->project = $project;
        $this->lproj = lizmap::getProject($repository.'~'.$project);
        $this->status = true;
        $this->config = $dv->getConfig();

        $layer = $this->lproj->getLayer( $layerId );
        $this->layer = $layer;
        $this->layername = $layer->getName();
        $this->datasource = $layer->getDatasourceParameters();
        $this->cnx = $layer->getDatasourceConnection();

        // Get layer type
        $this->provider = $layer->getProvider();
    }

    public function getStatus(){
        return $this->status;
    }

    public function getErrors(){
        return $this->errors;
    }

    private function validateFilter($filter){
        $black_items = array();
        if( preg_match('#'.implode( '|', $this->blackSqlWords ).'#i', $filter, $black_items) ){
            jLog::log("The EXP_FILTER param contains dangerous chars : " . implode(', ', $black_items ) );
            return null;
        }else{
            $filter = str_replace('intersects', 'ST_Intersects', $filter );
            $filter = str_replace('geom_from_gml', 'ST_GeomFromGML', $filter );
            $filter = str_replace('$geometry', '"' . $this->datasource->geocol . '"', $filter );
            return $filter;
        }
    }

    protected function getData($sql){

        $data = array();
        try{
            $q = $this->cnx->query( $sql );
            foreach( $q as $d){
                $data[] = $d;
            }
        }catch(Exception $e){
            jLog::log($e->getMessage(), 'error');
            $this->errors = array(
                'status'=>'error',
                'title'=>'Invalid Query',
                'detail'=>$e->getMessage()
            );
            return $this->errors;
        }
        return $data;
    }

    public function getFeatureCount($filter=null){

        // validate filter
        $filter = $this->validateFilter($filter);

        // SQL
        $sql = ' SELECT count(*) AS c';
        $sql.= ' FROM ' . $this->datasource->table;
        $sql.= ' WHERE True';
        if($filter){
            $sql.= " AND ( " . $filter ." )";
        }
        return $this->getData($sql);
    }

    public function getUniqueValues($fieldname, $filter=null){

        // Check fieldname
        $dbFieldsInfo = $this->layer->getDbFieldsInfo();
        $dataFields = $dbFieldsInfo->dataFields;
        if( !array_key_exists( $fieldname, $dataFields ) ){
            $this->errors = array(
                'status'=>'error',
                'title'=>'The field does not exists in the table: ',
                'detail'=>'given fieldname = ' . $fieldname
            );
            return $this->errors;
        }

        // validate filter
        $filter = $this->validateFilter($filter);

        // SQL
        $sql = ' SELECT ';
        $sql.= ' "' . $fieldname . '" AS v,';
        $sql.= ' Count(*) AS c';
        $sql.= ' FROM ' . $this->datasource->table;
        $sql.= ' WHERE True';
        if($filter){
            $sql.= " AND ( " . $filter ." )";
        }
        $sql.= ' GROUP BY v';
        $sql.= ' ORDER BY v';
        return $this->getData($sql);
    }

    public function getMinAndMaxValues($fieldname, $filter=null){
        // Check fieldname
        $dbFieldsInfo = $this->layer->getDbFieldsInfo();
        $dataFields = $dbFieldsInfo->dataFields;
        $fields = explode(',', $fieldname);
        foreach($fields as $field){
            if( !array_key_exists( $field, $dataFields ) ){
                $this->errors = array(
                    'status'=>'error',
                    'title'=>'The field does not exists in the table: ',
                    'detail'=>'given fieldname = ' . $field
                );
                return $this->errors;
            }
        }

        // validate filter
        $filter = $this->validateFilter($filter);

        // SQL
        $sql = ' SELECT ';
        $sql.= ' Min(Least("' . implode('","', $fields) . '")) AS min,';
        $sql.= ' Max(Greatest("' . implode('","', $fields) . '")) AS max';
        $sql.= ' FROM ' . $this->datasource->table;
        $sql.= ' WHERE True';
        if($filter){
            $sql.= " AND ( " . $filter ." )";
        }
        return $this->getData($sql);
    }

    public function getExtent($crs, $filter=null){
        // Get geometry column
        $dbFieldsInfo = $this->layer->getDbFieldsInfo();
        $geom = $dbFieldsInfo->geometryColumn;

        // validate filter
        $filter = $this->validateFilter($filter);

        // validate crs
        $vcrs = null;
        $a = explode(':', $crs);
        if( count($a) == 2 and $a[0] == 'EPSG' and ctype_digit($a[1]) ){
            $vcrs = $a[1];
        }

        // SQL
        $sql = ' SELECT ST_Extent(';
        if($vcrs)
            $sql.= 'ST_Transform(';
        $sql.= '"' . $geom .'"';
        if($vcrs)
            $sql.= ", " . $vcrs . ")";
        $sql.= ') AS bbox';
        $sql.= ' FROM ' . $this->datasource->table;
        $sql.= ' WHERE True';
        if($filter){
            $sql.= " AND ( " . $filter ." )";
        }
        return $this->getData($sql);
    }

}
