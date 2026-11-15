<?php

/**
 * Convert an uploaded vector file to GeoJSON with GDAL/OGR, so that it can
 * be imported by the digitizing tool.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

use Lizmap\Import\OgrConverter;

class convertCtrl extends jController
{
    /** @var int Maximum size of the uploaded file, in bytes */
    protected const MAX_UPLOAD_SIZE = 20000000;

    /**
     * Convert the uploaded file `file` to GeoJSON in EPSG:4326.
     *
     * Parameters: repository, project (the user must have access to the
     * project), file (uploaded file) and optional crs (EPSG code of CSV and
     * DXF files, which have no CRS).
     *
     * @return jResponseJson
     */
    public function index()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');

        $repository = $this->param('repository');
        $projectKey = $this->param('project');
        $project = null;
        if ($repository && $projectKey) {
            try {
                $project = lizmap::getProject($repository.'~'.$projectKey);
            } catch (\Exception $e) {
                $project = null;
            }
        }
        if (!$project || !$project->checkAcl()) {
            return $this->error($rep, 404, 'Unknown project');
        }

        if (!$this->request->isPostMethod() || !isset($_FILES['file'])) {
            return $this->error($rep, 400, 'No file');
        }
        $file = $_FILES['file'];
        if ($file['error'] != UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            return $this->error($rep, 400, 'Upload error');
        }
        if ($file['size'] > self::MAX_UPLOAD_SIZE) {
            return $this->error($rep, 413, 'The file is too big');
        }
        $extension = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        if (!OgrConverter::isSupported($extension)) {
            return $this->error($rep, 415, 'Unsupported format');
        }

        $converter = new OgrConverter();
        if (!$converter->isAvailable()) {
            return $this->error($rep, 501, 'GDAL/OGR is not installed on the server');
        }

        // GDAL needs the right extension to choose the driver
        $tmpDir = jApp::tempPath('convert/');
        jFile::createDir($tmpDir);
        $tmpFile = $tmpDir.uniqid('import_', true).'.'.$extension;
        if (!move_uploaded_file($file['tmp_name'], $tmpFile)) {
            return $this->error($rep, 500, 'Upload error');
        }

        try {
            $rep->data = $converter->toGeoJson($tmpFile, $extension, (string) $this->param('crs', ''));
        } catch (\RuntimeException $e) {
            jLog::log('Import conversion: '.$e->getMessage(), 'lizmapadmin');

            return $this->error($rep, 422, 'Unable to convert the file');
        } finally {
            @unlink($tmpFile);
        }

        return $rep;
    }

    /**
     * @param jResponseJson $rep
     * @param int           $code
     * @param string        $message
     *
     * @return jResponseJson
     */
    protected function error($rep, $code, $message)
    {
        $rep->setHttpStatus($code, $message);
        $rep->data = array('error' => $message);

        return $rep;
    }
}
