<?php

/**
 * Files imported in the data catalog and saved in the user profile. Saving
 * needs the lizmap.tools.import.save right on the repository of the map and
 * is limited by a quota per user.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

use Lizmap\Import\UserImports;

class userimportCtrl extends jController
{
    /**
     * List the files saved by the current user, with the quota.
     *
     * @return jResponseJson
     */
    public function index()
    {
        return $this->safely('doIndex');
    }

    protected function doIndex()
    {
        $rep = $this->getResponse('json');
        $repository = $this->checkMap($rep);
        if ($repository === null) {
            return $rep;
        }
        $files = array();
        foreach ($this->userFiles() as $file) {
            $files[] = array('id' => (int) $file->id, 'title' => $file->ititle, 'size' => (int) $file->isize);
        }
        $rep->data = array(
            'canSave' => jAcl2::check(UserImports::RIGHT, $repository),
            'quota' => UserImports::quota(),
            'files' => $files,
        );

        return $rep;
    }

    /**
     * Get the GeoJSON of a file of the current user.
     *
     * @return jResponseJson
     */
    public function get()
    {
        return $this->safely('doGet');
    }

    protected function doGet()
    {
        $rep = $this->getResponse('json');
        if ($this->checkMap($rep) === null) {
            return $rep;
        }
        $record = $this->dao()->get($this->intParam('id'));
        if (!$record || $record->login !== $this->login()) {
            return $this->error($rep, 404, 'Unknown file');
        }
        $rep->data = array(
            'id' => (int) $record->id,
            'title' => $record->title,
            'geojson' => json_decode($record->geojson, true),
        );

        return $rep;
    }

    /**
     * Save a file in the profile of the current user.
     *
     * Parameters: repository, project, title and geojson (FeatureCollection in EPSG:4326).
     *
     * @return jResponseJson
     */
    public function save()
    {
        return $this->safely('doSave');
    }

    protected function doSave()
    {
        $rep = $this->getResponse('json');
        $repository = $this->checkMap($rep);
        if ($repository === null) {
            return $rep;
        }
        if (!$this->request->isPostMethod()) {
            return $this->error($rep, 405, 'POST required');
        }
        if (!jAcl2::check(UserImports::RIGHT, $repository)) {
            return $this->error($rep, 403, 'Saving imported files is not allowed');
        }
        $title = trim(strip_tags((string) $this->param('title', '')));
        if ($title === '' || mb_strlen($title) > 200) {
            return $this->error($rep, 400, 'Invalid title');
        }
        $quota = UserImports::quota();
        $json = (string) $this->param('geojson', '');
        if (strlen($json) > $quota['size']) {
            return $this->error($rep, 413, 'Quota exceeded');
        }
        $geojson = UserImports::normalizeGeoJson($json);
        if ($geojson === null) {
            return $this->error($rep, 400, 'Invalid GeoJSON');
        }
        $usedSize = 0;
        $usedCount = 0;
        foreach ($this->userFiles() as $file) {
            $usedSize += (int) $file->isize;
            ++$usedCount;
        }
        if (!UserImports::fitsQuota($quota, $usedSize, $usedCount, strlen($geojson))) {
            return $this->error($rep, 413, 'Quota exceeded');
        }

        $record = jDao::createRecord('lizmap~userimport', UserImports::PROFILE);
        $record->login = $this->login();
        $record->title = $title;
        $record->geojson = $geojson;
        $record->size = strlen($geojson);
        $this->dao()->insert($record);
        $rep->data = array('id' => (int) $record->id, 'title' => $record->title, 'size' => (int) $record->size);

        return $rep;
    }

    /**
     * Delete a file of the current user.
     *
     * @return jResponseJson
     */
    public function delete()
    {
        return $this->safely('doDelete');
    }

    protected function doDelete()
    {
        $rep = $this->getResponse('json');
        if ($this->checkMap($rep) === null) {
            return $rep;
        }
        if (!$this->request->isPostMethod()) {
            return $this->error($rep, 405, 'POST required');
        }
        $dao = $this->dao();
        $record = $dao->get($this->intParam('id'));
        if (!$record || $record->login !== $this->login()) {
            return $this->error($rep, 404, 'Unknown file');
        }
        $dao->delete($record->id);
        $rep->data = array('deleted' => (int) $record->id);

        return $rep;
    }

    /**
     * Files of the current user, without their content.
     *
     * @return iterable
     */
    protected function userFiles()
    {
        $db = jDb::getConnection(UserImports::PROFILE);

        return $db->query('SELECT id, ititle, isize FROM lizmap_user_import WHERE usr_login = '
            .$db->quote($this->login()).' ORDER BY ititle');
    }

    /**
     * Run an action, logging database errors.
     *
     * @param string $method the action implementation
     *
     * @return jResponseJson
     */
    protected function safely($method)
    {
        try {
            return $this->{$method}();
        } catch (\Throwable $e) {
            jLog::log('User imports: '.$e->getMessage(), 'lizmapadmin');
            jLog::logEx($e, 'error');

            return $this->error($this->getResponse('json'), 500, 'Unable to read or save the file');
        }
    }

    /**
     * Check the user is connected and can access the map.
     *
     * @param jResponseJson $rep
     *
     * @return null|string the repository key, or null with an error set in the response
     */
    protected function checkMap($rep)
    {
        if (!jAuth::isConnected()) {
            $this->error($rep, 401, 'User is not connected');

            return null;
        }
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
            $this->error($rep, 404, 'Unknown project');

            return null;
        }
        UserImports::ensureInstalled();

        return $repository;
    }

    protected function dao()
    {
        return jDao::get('lizmap~userimport', UserImports::PROFILE);
    }

    protected function login()
    {
        return jAuth::getUserSession()->login;
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
