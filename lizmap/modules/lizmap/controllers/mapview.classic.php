<?php

/**
 * Map views saved by users: layer tree order and layers added from the
 * data catalog, per map.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */
class mapviewCtrl extends jController
{
    /** @var int Maximum size of a saved configuration, in bytes */
    protected const MAX_CONFIG_SIZE = 200000;

    /** @var string Database profile of the users tables */
    protected const PROFILE = 'jauth';

    /**
     * List the views of the current user for a map.
     *
     * @return jResponseJson
     */
    public function index()
    {
        $rep = $this->getResponse('json');
        $map = $this->checkMap($rep);
        if ($map === null) {
            return $rep;
        }

        $views = array();
        foreach ($this->dao()->findByUserMap($this->login(), $map) as $record) {
            $views[] = array('id' => (int) $record->id, 'name' => $record->name);
        }
        $rep->data = $views;

        return $rep;
    }

    /**
     * Get a view of the current user.
     *
     * @return jResponseJson
     */
    public function get()
    {
        $rep = $this->getResponse('json');
        $map = $this->checkMap($rep);
        if ($map === null) {
            return $rep;
        }
        $record = $this->dao()->get($this->intParam('id'));
        if (!$record || $record->login !== $this->login() || $record->map !== $map) {
            return $this->error($rep, 404, 'Unknown view');
        }
        $rep->data = array(
            'id' => (int) $record->id,
            'name' => $record->name,
            'config' => json_decode($record->config, true),
        );

        return $rep;
    }

    /**
     * Save a view, replacing the view of the same name.
     *
     * Parameters: repository, project, name and config (JSON object).
     *
     * @return jResponseJson
     */
    public function save()
    {
        $rep = $this->getResponse('json');
        $map = $this->checkMap($rep);
        if ($map === null) {
            return $rep;
        }
        if ($this->request->method != 'POST') {
            return $this->error($rep, 405, 'POST required');
        }
        $name = trim(strip_tags((string) $this->param('name', '')));
        if ($name === '' || mb_strlen($name) > 100) {
            return $this->error($rep, 400, 'Invalid name');
        }
        $config = (string) $this->param('config', '');
        $decoded = json_decode($config, true);
        if (strlen($config) > self::MAX_CONFIG_SIZE || !is_array($decoded)) {
            return $this->error($rep, 400, 'Invalid configuration');
        }

        $dao = $this->dao();
        $record = $dao->getByUserMapName($this->login(), $map, $name);
        if ($record) {
            $record->config = json_encode($decoded);
            $dao->update($record);
        } else {
            $record = jDao::createRecord('lizmap~mapview', self::PROFILE);
            $record->login = $this->login();
            $record->map = $map;
            $record->name = $name;
            $record->config = json_encode($decoded);
            $dao->insert($record);
        }
        $rep->data = array('id' => (int) $record->id, 'name' => $record->name);

        return $rep;
    }

    /**
     * Delete a view of the current user.
     *
     * @return jResponseJson
     */
    public function delete()
    {
        $rep = $this->getResponse('json');
        $map = $this->checkMap($rep);
        if ($map === null) {
            return $rep;
        }
        if ($this->request->method != 'POST') {
            return $this->error($rep, 405, 'POST required');
        }
        $dao = $this->dao();
        $record = $dao->get($this->intParam('id'));
        if (!$record || $record->login !== $this->login() || $record->map !== $map) {
            return $this->error($rep, 404, 'Unknown view');
        }
        $dao->delete($record->id);
        $rep->data = array('deleted' => (int) $record->id);

        return $rep;
    }

    /**
     * Check the user is connected and can access the map.
     *
     * @param jResponseJson $rep
     *
     * @return null|string the map key, or null with an error set in the response
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
        $this->ensureTable();

        return $repository.':'.$projectKey;
    }

    /**
     * Create the table on existing installations.
     */
    protected function ensureTable()
    {
        $flag = jApp::tempPath('lizmap_map_view.created');
        if (file_exists($flag)) {
            return;
        }
        $db = jDb::getConnection(self::PROFILE);
        $file = jApp::getModulePath('lizmap').'/install/sql/lizmapview.'.$db->dbms.'.sql';
        if (file_exists($file)) {
            $db->tools()->execSQLScript($file);
        }
        file_put_contents($flag, '1');
    }

    protected function dao()
    {
        return jDao::get('lizmap~mapview', self::PROFILE);
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
