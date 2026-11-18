<?php

/**
 * Lizmap administration: external services configured and tested by the
 * administrator, offered in "Add an external service" of the data catalog
 * to all the users, to the connected ones, or to some groups and users.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

use Lizmap\Import\SharedServices;
use Lizmap\Import\UserImports;
use Lizmap\Request\Proxy;

class catalog_servicesCtrl extends jController
{
    public $pluginParams = array(
        '*' => array('jacl2.right' => 'lizmap.admin.services.view'),
        'save' => array('jacl2.right' => 'lizmap.admin.services.update'),
        'delete' => array('jacl2.right' => 'lizmap.admin.services.update'),
        'test' => array('jacl2.right' => 'lizmap.admin.services.update'),
    );

    /**
     * The services, and the form to add or edit one.
     *
     * @return jResponseHtml
     */
    public function index()
    {
        $store = new SharedServices();
        $services = $store->all();
        $edit = null;
        $id = (string) $this->param('id', '');
        if ($id !== '') {
            $edit = $store->get($id);
        }
        // A service of an ArcGIS directory, with the availability of the directory
        $from = $store->get((string) $this->param('from', ''));
        $pick = $this->intParam('pick');
        if ($from && $pick !== null && isset($from['test']['services'][$pick])) {
            $picked = $from['test']['services'][$pick];
            $edit = array('id' => '', 'type' => 'arcgis', 'url' => $picked['url'], 'title' => $picked['title'],
                'description' => $from['description'], 'access' => $from['access'],
                'groups' => $from['groups'], 'users' => $from['users']);
        }
        // Keep the values of a form with errors
        if (!empty($_SESSION['lizmapSharedServiceForm'])) {
            $edit = $_SESSION['lizmapSharedServiceForm'];
            unset($_SESSION['lizmapSharedServiceForm']);
        }
        $groups = $this->groups();
        $types = array();
        foreach (UserImports::SERVICE_TYPES as $type) {
            $types[$type] = jLocale::get('view~dictionnary.catalog.external.type.'.$type);
        }
        foreach ($services as &$service) {
            $service['typeLabel'] = $types[$service['type']] ?? $service['type'];
            $service['groupsText'] = implode(', ', array_map(static function ($group) use ($groups) {
                return $groups[$group] ?? $group;
            }, $service['groups']));
            $service['usersText'] = implode(', ', $service['users']);
            $service['layerCount'] = count($service['test']['layers'] ?? array());
            $service['serviceCount'] = count($service['test']['services'] ?? array());
        }
        unset($service);
        $edit = $edit ?? array(
            'id' => '', 'type' => 'wms', 'url' => '', 'title' => '', 'description' => '',
            'access' => 'all', 'groups' => array(), 'users' => array(),
        );
        $edit['usersText'] = implode(', ', $edit['users']);
        $userOptions = array();
        foreach ($edit['users'] as $login) {
            $user = jAuth::getUser($login);
            $userOptions[] = array('login' => $login, 'label' => $user ? $this->userLabel($user) : $login);
        }
        $typeOptions = array();
        foreach ($types as $type => $label) {
            $typeOptions[] = array('id' => $type, 'label' => $label, 'selected' => $edit['type'] === $type);
        }
        $groupOptions = array();
        foreach ($groups as $groupId => $groupName) {
            $groupOptions[] = array('id' => (string) $groupId, 'label' => $groupName, 'selected' => in_array($groupId, $edit['groups'], true));
        }

        /** @var jResponseHtml $rep */
        $rep = $this->getResponse('html');
        $tpl = new jTpl();
        $tpl->assign('services', $services);
        $tpl->assign('edit', $edit);
        $tpl->assign('typeOptions', $typeOptions);
        $tpl->assign('groupOptions', $groupOptions);
        $tpl->assign('userOptions', $userOptions);
        $tpl->assign('groupSize', max(2, min(8, count($groupOptions))));
        $tpl->assign('token', $this->token());
        $tpl->assign('canUpdate', jAcl2::check('lizmap.admin.services.update'));
        $tpl->assign('catalogEnabled', (new \Lizmap\App\ModulesConfig())->isEnabled('catalog'));
        $rep->body->assign('MAIN', $tpl->fetch('admin~catalog_services'));
        $rep->body->assign('selectedMenuItem', 'lizmap_catalog_services');

        return $rep;
    }

    /**
     * Add or replace a service, then test it.
     *
     * @return jResponseRedirect
     */
    public function save()
    {
        if (!$this->checkToken()) {
            return $this->toIndex();
        }
        $id = (string) $this->param('id', '');
        $data = array(
            'type' => (string) $this->param('type', ''),
            'url' => (string) $this->param('url', ''),
            'title' => (string) $this->param('title', ''),
            'description' => (string) $this->param('description', ''),
            'access' => (string) $this->param('access', 'all'),
            'groups' => array_values(array_intersect((array) $this->param('groups', array()), array_keys($this->groups()))),
            'users' => $this->existingUsers((array) $this->param('users', array())),
        );
        $store = new SharedServices();
        list($service, $errors) = $store->save($data, $id !== '' ? $id : null);
        if ($errors) {
            foreach ($errors as $field) {
                jMessage::add(jLocale::get('admin~catalog_services.error.'.$field), 'error');
            }
            $_SESSION['lizmapSharedServiceForm'] = array('id' => $id) + $data;

            return $this->toIndex();
        }
        $this->runTest($store, $service);
        jMessage::add(jLocale::get('admin~catalog_services.saved'));

        return $this->toIndex();
    }

    /**
     * Users whose login or name contains the searched text, to add them to a service.
     *
     * @return jResponseJson
     */
    public function users()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');
        $search = trim(str_replace(array('%', '_'), '', (string) $this->param('q', '')));
        $users = array();
        if (mb_strlen($search) >= 1) {
            try {
                foreach (jAuth::getUserList('%'.$search.'%') as $user) {
                    $users[] = array('login' => (string) $user->login, 'label' => $this->userLabel($user));
                    if (count($users) >= 20) {
                        break;
                    }
                }
            } catch (\Throwable $e) {
                jLog::log('Shared external services, users: '.$e->getMessage(), 'lizmapadmin');
            }
        }
        $rep->data = $users;

        return $rep;
    }

    /**
     * Test a service again.
     *
     * @return jResponseRedirect
     */
    public function test()
    {
        if (!$this->checkToken()) {
            return $this->toIndex();
        }
        $store = new SharedServices();
        $service = $store->get((string) $this->param('id', ''));
        if ($service) {
            $this->runTest($store, $service);
        }

        return $this->toIndex();
    }

    /**
     * Delete a service.
     *
     * @return jResponseRedirect
     */
    public function delete()
    {
        if ($this->checkToken() && (new SharedServices())->delete((string) $this->param('id', ''))) {
            jMessage::add(jLocale::get('admin~catalog_services.deleted'));
        }

        return $this->toIndex();
    }

    /**
     * Read the service from the server and keep the result. The browsers of
     * the users read it too, so a service may also need to allow requests
     * from this site (CORS).
     *
     * @param SharedServices $store   the services
     * @param array          $service the service
     */
    protected function runTest(SharedServices $store, array $service)
    {
        try {
            list($body, $contentType, $code) = Proxy::getRemoteData(SharedServices::testUrl($service['type'], $service['url']));
            $result = SharedServices::checkResponse($service['type'], (int) $code, (string) $contentType, (string) $body, $service['url']);
            // The services of the folders of an ArcGIS directory
            foreach (array_slice($result['folders'] ?? array(), 0, 20) as $folder) {
                $folderUrl = SharedServices::arcgisFolderUrl($service['url'], $folder);
                if ($folderUrl === null) {
                    continue;
                }
                list($body, , $code) = Proxy::getRemoteData($folderUrl);
                $data = json_decode((string) $body, true);
                if ((int) $code === 200 && is_array($data)) {
                    $result['services'] = array_merge($result['services'], SharedServices::arcgisServices($data, $service['url']));
                }
            }
            if (isset($result['folders'])) {
                $result['message'] = 'Directory: '.count($result['services']).' service(s)';
            }
        } catch (\Throwable $e) {
            $result = array('ok' => false, 'message' => $e->getMessage());
        }
        $store->setTest($service['id'], $result);
        if (isset($result['folders'])) {
            jMessage::add(jLocale::get('admin~catalog_services.test.directory', array($service['title'], count($result['services']))), 'warning');
        } else {
            jMessage::add(
                jLocale::get('admin~catalog_services.test.'.($result['ok'] ? 'ok' : 'error'), array($service['title'], $result['message'])),
                $result['ok'] ? 'info' : 'warning'
            );
        }
    }

    /**
     * @param object $user a user of jAuth
     *
     * @return string the login, with the name or email when the user has one
     */
    protected function userLabel($user)
    {
        $name = trim(($user->firstname ?? '').' '.($user->lastname ?? ''));
        if ($name === '') {
            $name = (string) ($user->email ?? '');
        }

        return $name !== '' ? $user->login.' ('.$name.')' : (string) $user->login;
    }

    /**
     * @param array $logins the logins sent by the form
     *
     * @return string[] the logins of existing users
     */
    protected function existingUsers(array $logins)
    {
        $users = array();
        foreach (array_slice($logins, 0, SharedServices::MAX_MEMBERS) as $login) {
            $login = trim((string) $login);
            if ($login !== '' && !in_array($login, $users, true) && jAuth::getUser($login)) {
                $users[] = $login;
            }
        }

        return $users;
    }

    /**
     * @return array<string, string> the user groups, by id
     */
    protected function groups()
    {
        $groups = array();
        foreach (jAcl2DbUserGroup::getGroupList() as $group) {
            if ($group->grouptype == jAcl2DbUserGroup::GROUPTYPE_PRIVATE || $group->id_aclgrp === '__anonymous') {
                continue;
            }
            $groups[$group->id_aclgrp] = $group->name;
        }

        return $groups;
    }

    /**
     * @return jResponseRedirect
     */
    protected function toIndex()
    {
        /** @var jResponseRedirect $rep */
        $rep = $this->getResponse('redirect');
        $rep->action = 'admin~catalog_services:index';

        return $rep;
    }

    /**
     * @return string the token of the forms of the session, against cross-site requests
     */
    protected function token()
    {
        if (empty($_SESSION['lizmapSharedServicesToken'])) {
            $_SESSION['lizmapSharedServicesToken'] = bin2hex(random_bytes(16));
        }

        return $_SESSION['lizmapSharedServicesToken'];
    }

    /**
     * @return bool true for a POST request with the token of the session
     */
    protected function checkToken()
    {
        return $this->request->isPostMethod()
            && !empty($_SESSION['lizmapSharedServicesToken'])
            && hash_equals($_SESSION['lizmapSharedServicesToken'], (string) $this->param('token', ''));
    }
}
