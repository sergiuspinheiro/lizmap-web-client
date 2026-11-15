<?php

/**
 * Geographic data catalog: lists the maps and layers the current user
 * can access, so that they can be added to the map being viewed.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */
class catalogCtrl extends jController
{
    /**
     * List the repositories and projects the user can access.
     *
     * @return jResponseJson
     */
    public function index()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');

        $repositories = array();
        foreach (lizmap::getRepositoryList() as $repoKey) {
            if (!jAcl2::check('lizmap.repositories.view', $repoKey)) {
                continue;
            }
            $lrep = lizmap::getRepository($repoKey);
            if (!$lrep || !$lrep->hasValidPath()) {
                continue;
            }

            $projects = array();
            foreach ($lrep->getProjectsMainData() as $meta) {
                // Same rules as the projects list on the landing page
                if ($meta->needsUpdateError() || !$meta->getAcl() || $meta->getHidden()) {
                    continue;
                }
                $projects[] = array(
                    'id' => $meta->getId(),
                    'title' => $meta->getTitle(),
                    'abstract' => $meta->getAbstract(),
                    'keywords' => $meta->getKeywordList(),
                    'proj' => $meta->getProj(),
                    'bbox' => $meta->getBbox(),
                    'url' => jUrl::get('view~map:index', array('repository' => $repoKey, 'project' => $meta->getId())),
                    'layersUrl' => jUrl::get('lizmap~catalog:layers', array('repository' => $repoKey, 'project' => $meta->getId())),
                );
            }
            if (count($projects) == 0) {
                continue;
            }
            $repositories[] = array(
                'id' => $repoKey,
                'title' => $lrep->getLabel(),
                'projects' => $projects,
            );
        }

        $rep->data = array('repositories' => $repositories);

        return $rep;
    }

    /**
     * List the layers of a project the user can access.
     *
     * Layers hidden to the user groups (group visibility) are removed
     * by the project updated configuration.
     *
     * @return jResponseJson
     */
    public function layers()
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
            $rep->setHttpStatus(404, 'Not Found');
            $rep->data = array('error' => 'Unknown project');

            return $rep;
        }

        $config = $project->getUpdatedConfig();
        $layers = array();
        foreach ($config->layers as $layer) {
            $isGroupAsLayer = property_exists($layer, 'groupAsLayer')
                && filter_var($layer->groupAsLayer, FILTER_VALIDATE_BOOLEAN);
            if ($layer->type != 'layer' && !$isGroupAsLayer) {
                continue;
            }
            if (in_array(strtolower($layer->name), array('overview', 'hidden'))) {
                continue;
            }
            $layers[] = array(
                'name' => $layer->name,
                'wmsName' => (property_exists($layer, 'shortname') && $layer->shortname) ? $layer->shortname : $layer->name,
                'title' => $layer->title,
                'abstract' => property_exists($layer, 'abstract') ? $layer->abstract : '',
                'geometryType' => property_exists($layer, 'geometryType') ? $layer->geometryType : '',
                'extent' => property_exists($layer, 'extent') ? $layer->extent : null,
                'crs' => property_exists($layer, 'crs') ? $layer->crs : '',
                'baseLayer' => property_exists($layer, 'baseLayer') && filter_var($layer->baseLayer, FILTER_VALIDATE_BOOLEAN),
                'imageFormat' => property_exists($layer, 'imageFormat') ? $layer->imageFormat : 'image/png',
            );
        }

        $rep->data = array(
            'repository' => $repository,
            'project' => $projectKey,
            'title' => $project->getTitle(),
            'wmsUrl' => jUrl::getFull('lizmap~service:index', array('repository' => $repository, 'project' => $projectKey)),
            'layers' => $layers,
        );

        return $rep;
    }
}
