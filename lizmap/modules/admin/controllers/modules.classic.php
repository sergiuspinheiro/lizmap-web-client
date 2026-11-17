<?php

/**
 * Lizmap administration: activation of the optional modules of the map
 * (data catalog, layer comparison, AI assistant) and settings of the AI
 * assistant.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

use Lizmap\App\ModulesConfig;

class modulesCtrl extends jController
{
    public $pluginParams = array(
        '*' => array('jacl2.right' => 'lizmap.admin.services.view'),
        'save' => array('jacl2.right' => 'lizmap.admin.services.update'),
    );

    /**
     * Display the settings.
     *
     * @return jResponseHtml
     */
    public function index()
    {
        /** @var jResponseHtml $rep */
        $rep = $this->getResponse('html');

        $config = new ModulesConfig();
        // Keep the form with its errors after a failed save
        $form = $this->param('errors') ? jForms::get('admin~modules') : null;
        if (!$form) {
            $form = jForms::create('admin~modules');
            foreach ($config->formValues() as $key => $value) {
                $form->setData($key, $value);
            }
        }
        $form->setData('apiKey', '');

        $tpl = new jTpl();
        $tpl->assign('form', $form);
        $tpl->assign('hasApiKey', $config->hasApiKey());
        $tpl->assign('canUpdate', jAcl2::check('lizmap.admin.services.update'));
        $rep->body->assign('MAIN', $tpl->fetch('admin~modules'));
        $rep->body->assign('selectedMenuItem', 'lizmap_modules');

        return $rep;
    }

    /**
     * Save the settings.
     *
     * @return jResponseRedirect
     */
    public function save()
    {
        /** @var jResponseRedirect $rep */
        $rep = $this->getResponse('redirect');
        $rep->action = 'admin~modules:index';

        /** @var null|jFormsBase $form */
        $form = jForms::get('admin~modules');
        if (!$form || !$this->request->isPostMethod()) {
            return $rep;
        }
        // Checks the token of the form too
        $form->initFromRequest();
        if (!$form->check()) {
            $rep->params['errors'] = '1';

            return $rep;
        }

        $errors = (new ModulesConfig())->save(array(
            'modules' => array(
                'catalog' => $form->getData('catalog') === 'on',
                'layerCompare' => $form->getData('layerCompare') === 'on',
                'aiAssistant' => $form->getData('aiAssistant') === 'on',
            ),
            'provider' => $form->getData('provider'),
            'model' => $form->getData('model'),
            'url' => $form->getData('url'),
            'apiKey' => $form->getData('apiKey'),
            'removeApiKey' => (bool) $form->getData('removeApiKey'),
            'allowAnonymous' => $form->getData('allowAnonymous') === 'on',
            'sendStatistics' => $form->getData('sendStatistics') === 'on',
            'maxFeatures' => $form->getData('maxFeatures'),
            'requestsPerHour' => $form->getData('requestsPerHour'),
            'quotaSize' => $form->getData('quotaSize'),
            'quotaLayers' => $form->getData('quotaLayers'),
        ));
        if ($errors) {
            foreach ($errors as $control) {
                $form->setErrorOn($control, jLocale::get('admin~modules.error.invalid'));
            }
            $rep->params['errors'] = '1';

            return $rep;
        }

        $form->setData('apiKey', '');
        jForms::destroy('admin~modules');
        jMessage::add(jLocale::get('admin~modules.saved'));

        return $rep;
    }
}
