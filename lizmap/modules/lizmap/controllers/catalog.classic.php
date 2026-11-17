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
use GuzzleHttp\Psr7\StreamWrapper as Psr7StreamWrapper;
use JsonMachine\Items as JsonMachineItems;
use Lizmap\Ai\Assistant;
use Lizmap\Ai\AssistantException;
use Lizmap\Ai\LayerStatistics;
use Lizmap\Request\WFSRequest;

class catalogCtrl extends jController
{
    /** @var int Maximum number of assistant requests of a user session in an hour */
    protected const ASSISTANT_REQUESTS_PER_HOUR = 60;

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

        $layers = $this->projectLayers($project);

        $rep->data = array(
            'repository' => $repository,
            'project' => $projectKey,
            'title' => $project->getTitle(),
            'wmsUrl' => jUrl::getFull('lizmap~service:index', array('repository' => $repository, 'project' => $projectKey)),
            'mapUrl' => jUrl::get('view~map:index', array('repository' => $repository, 'project' => $projectKey)),
            'layers' => $layers,
        );

        return $rep;
    }

    /**
     * The layers of a project the user can access.
     *
     * Layers hidden to the user groups (group visibility) are removed
     * by the project updated configuration.
     *
     * @param \Lizmap\Project\Project $project the project
     *
     * @return list<array> the layers
     */
    protected function projectLayers($project)
    {
        $config = $project->getUpdatedConfig();
        $attributeLayers = property_exists($config, 'attributeLayers') ? (array) $config->attributeLayers : array();
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
                'styles' => property_exists($layer, 'styles') ? array_values((array) $layer->styles) : array(),
                'popup' => property_exists($layer, 'popup') && filter_var($layer->popup, FILTER_VALIDATE_BOOLEAN),
                'attributeTable' => array_key_exists($layer->name, $attributeLayers),
                // WFS type name, as given by QGIS Server
                'typeName' => str_replace(' ', '_', (property_exists($layer, 'shortname') && $layer->shortname) ? $layer->shortname : $layer->name),
            );
        }

        return $layers;
    }

    /**
     * Status of the AI assistant for the current user.
     *
     * @return jResponseJson
     */
    public function assistant()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');
        $assistant = $this->getAssistant();
        $rep->data = array(
            'enabled' => $assistant->isAllowed(jAuth::isConnected()),
            'analysis' => $assistant->canAnalyse(),
        );

        return $rep;
    }

    /**
     * Search the catalog layers with a question in natural language.
     *
     * Parameter: q, the question (POST).
     *
     * @return jResponseJson
     */
    public function search()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');
        $assistant = $this->getAssistant();
        if ($error = $this->checkAssistant($assistant)) {
            return $this->error($rep, $error[0], $error[1]);
        }
        // A local model without GPU can take minutes to answer
        set_time_limit(330);
        $question = trim((string) $this->param('q', ''));
        if ($question === '' || mb_strlen($question) > 500) {
            return $this->error($rep, 400, 'The question must have 1 to 500 characters');
        }

        $start = microtime(true);
        $index = $this->cachedCatalogIndex();
        $indexTime = microtime(true) - $start;

        try {
            $rep->data = $assistant->search($question, $index);
            jLog::log(sprintf(
                'AI assistant search: %d layers read in %.1f s, answer of %s in %.1f s (%s)',
                count($index),
                $indexTime,
                $assistant->provider(),
                microtime(true) - $start - $indexTime,
                $assistant->lastAnswerInfo(),
            ), 'lizmapadmin');
        } catch (AssistantException $e) {
            jLog::log('AI assistant search failed: '.$e->getMessage().' ('.$assistant->lastAnswerInfo().')', 'lizmapadmin');

            return $this->assistantError($rep, $e);
        }

        return $rep;
    }

    /**
     * Analyse a layer of the catalog with the AI assistant.
     *
     * Parameters (POST): repository, project, layer (layer name) and optional q (question).
     * Aggregated statistics of the attributes are sent only for the layers with an attribute
     * table, which the user can already see, and when sendStatistics is on.
     *
     * @return jResponseJson
     */
    public function analyse()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');
        $assistant = $this->getAssistant();
        if ($error = $this->checkAssistant($assistant)) {
            return $this->error($rep, $error[0], $error[1]);
        }
        // A local model without GPU can take minutes to answer
        set_time_limit(330);
        $question = trim((string) $this->param('q', ''));
        if (mb_strlen($question) > 500) {
            return $this->error($rep, 400, 'The question must have at most 500 characters');
        }

        $repository = $this->param('repository');
        $projectKey = $this->param('project');
        $layerName = $this->param('layer');
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
        $layer = null;
        foreach ($this->projectLayers($project) as $item) {
            if ($item['name'] === $layerName) {
                $layer = $item;

                break;
            }
        }
        if (!$layer) {
            return $this->error($rep, 404, 'Unknown layer');
        }

        $lrep = lizmap::getRepository($repository);
        $entry = Assistant::layerIndexEntry(
            $repository,
            $lrep ? $lrep->getLabel() : $repository,
            $projectKey,
            $project->getTitle(),
            $layer,
        );

        $statistics = null;
        if ($assistant->canAnalyse() && $layer['attributeTable']) {
            $statistics = $this->layerStatistics($project, $layer, $assistant->maxFeatures());
        }

        try {
            $rep->data = $assistant->analyse($entry, $statistics, $question, jLocale::getCurrentLocale());
            $rep->data['statistics'] = $statistics;
        } catch (AssistantException $e) {
            return $this->assistantError($rep, $e);
        }

        return $rep;
    }

    /**
     * @return Assistant
     */
    protected function getAssistant()
    {
        $config = jApp::config();
        $section = property_exists($config, 'lizmapAi') ? (array) $config->lizmapAi : array();

        return new Assistant($section);
    }

    /**
     * Check the user can use the assistant, and count the request.
     *
     * @param Assistant $assistant
     *
     * @return null|array{int, string} the HTTP error, or null
     */
    protected function checkAssistant($assistant)
    {
        if (!$assistant->isEnabled()) {
            return array(404, 'The AI assistant is not enabled');
        }
        if (!$assistant->isAllowed(jAuth::isConnected())) {
            return array(401, 'User is not connected');
        }
        if (!$this->request->isPostMethod()) {
            return array(405, 'POST is required');
        }
        // Limit the costs: a number of requests by hour and user session
        $now = time();
        $requests = array_filter(
            $_SESSION['lizmapAiRequests'] ?? array(),
            static function ($time) use ($now) {
                return $time > $now - 3600;
            }
        );
        if (count($requests) >= self::ASSISTANT_REQUESTS_PER_HOUR) {
            return array(429, 'Too many requests to the AI assistant, try again later');
        }
        $requests[] = $now;
        $_SESSION['lizmapAiRequests'] = array_values($requests);

        return null;
    }

    /**
     * The catalog index, cached for some minutes by user: reading every
     * project of the server is long.
     *
     * @return list<array>
     */
    protected function cachedCatalogIndex()
    {
        $login = jAuth::isConnected() ? jAuth::getUserSession()->login : '__anonymous';
        $key = 'lizmapAiIndex_'.sha1($login);

        try {
            $cached = jCache::get($key);
            if (is_string($cached)) {
                $index = json_decode($cached, true);
                if (is_array($index)) {
                    return $index;
                }
            }
        } catch (\Exception $e) {
            // No cache: read the projects
        }
        $index = $this->catalogIndex();

        try {
            jCache::set($key, json_encode($index), 900);
        } catch (\Exception $e) {
            jLog::logEx($e, 'error');
        }

        return $index;
    }

    /**
     * The layers of every project the user can access, for the assistant.
     *
     * @return list<array>
     */
    protected function catalogIndex()
    {
        $index = array();
        foreach (lizmap::getRepositoryList() as $repoKey) {
            if (!jAcl2::check('lizmap.repositories.view', $repoKey)) {
                continue;
            }
            $lrep = lizmap::getRepository($repoKey);
            if (!$lrep || !$lrep->hasValidPath()) {
                continue;
            }
            foreach ($lrep->getProjectsMainData() as $meta) {
                if ($meta->needsUpdateError() || !$meta->getAcl() || $meta->getHidden()) {
                    continue;
                }
                try {
                    $project = lizmap::getProject($repoKey.'~'.$meta->getId());
                } catch (\Exception $e) {
                    continue;
                }
                if (!$project || !$project->checkAcl()) {
                    continue;
                }
                foreach ($this->projectLayers($project) as $layer) {
                    $index[] = Assistant::layerIndexEntry(
                        $repoKey,
                        $lrep->getLabel(),
                        $meta->getId(),
                        $meta->getTitle(),
                        $layer,
                        (array) $meta->getKeywordList(),
                    );
                    if (count($index) >= Assistant::MAX_INDEX_LAYERS) {
                        return $index;
                    }
                }
            }
        }

        return $index;
    }

    /**
     * Aggregated statistics of the attributes of a layer, read with WFS
     * (the filters by login and by polygon of the project apply).
     *
     * @param \Lizmap\Project\Project $project
     * @param array                    $layer
     * @param int                      $maxFeatures
     *
     * @return null|array the statistics, or null if the features cannot be read
     */
    protected function layerStatistics($project, $layer, $maxFeatures)
    {
        $params = array(
            'SERVICE' => 'WFS',
            'VERSION' => '1.0.0',
            'REQUEST' => 'GetFeature',
            'TYPENAME' => $layer['typeName'],
            'OUTPUTFORMAT' => 'GeoJSON',
            'GEOMETRYNAME' => 'none',
            'MAXFEATURES' => (string) $maxFeatures,
        );

        try {
            $request = new WFSRequest($project, $params, lizmap::getServices());
            $result = $request->process();
            if ($result->getCode() >= 400 || !str_contains(strtolower($result->getMime()), 'json')) {
                return null;
            }
            $stream = Psr7StreamWrapper::getResource($result->getBodyAsStream());
            $features = JsonMachineItems::fromStream($stream, array('pointer' => '/features'));
            $statistics = new LayerStatistics();
            $statistics->addFeatures($features, $maxFeatures);

            return $statistics->toArray();
        } catch (\Throwable $e) {
            jLog::logEx($e, 'error');

            return null;
        }
    }

    /**
     * @param jResponseJson       $rep
     * @param AssistantException $e
     *
     * @return jResponseJson
     */
    protected function assistantError($rep, $e)
    {
        jLog::log('AI assistant: '.$e->getMessage(), 'lizmapadmin');
        $code = $e->getCode() >= 400 ? $e->getCode() : 502;

        return $this->error($rep, $code, $e->getMessage());
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
