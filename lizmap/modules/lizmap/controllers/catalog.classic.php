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
use Lizmap\Ai\FeatureLocator;
use Lizmap\Ai\FeatureSample;
use Lizmap\Ai\LayerStatistics;
use Lizmap\Documents\DocumentContext;
use Lizmap\Documents\DocumentStore;
use Lizmap\App\ModulesConfig;
use Lizmap\Request\WFSRequest;

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
        if (!(new ModulesConfig())->isEnabled('catalog')) {
            return $this->error($rep, 404, 'The data catalog is not enabled');
        }

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
        if (!(new ModulesConfig())->isEnabled('catalog')) {
            return $this->error($rep, 404, 'The data catalog is not enabled');
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

        // The answer can take minutes: release the PHP session lock, so that
        // the other requests of the user (map, tiles, popups) are not blocked
        session_write_close();

        try {
            $data = $assistant->search($question, $index, jLocale::getCurrentLocale());
            if ($data['keywords']) {
                $data['answer'] = jLocale::get('view~dictionnary.catalog.ai.keywords');
            }
            $rep->data = $data;
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

        list($project, $layer) = $this->requestedLayer();
        if (!$layer) {
            return $this->error($rep, 404, 'Unknown layer');
        }
        $repository = $this->param('repository');
        $projectKey = $this->param('project');

        $lrep = lizmap::getRepository($repository);
        $entry = Assistant::layerIndexEntry(
            $repository,
            $lrep ? $lrep->getLabel() : $repository,
            $projectKey,
            $project->getTitle(),
            $layer,
        );

        // Reference documents linked to the layer (regulations, notes...)
        $documentStore = new DocumentStore(jApp::varPath('documents/'));
        $hasDocuments = count($documentStore->linksOf($repository, $projectKey, $layer['name'])) > 0;

        $statistics = null;
        $sample = null;
        if ($assistant->canSendFeatures()) {
            // The features themselves (e.g. to a local model): read once for both,
            // less of them when documents are sent too
            list($statistics, $sample) = $this->layerFeatures($project, $layer, $assistant, $question, $assistant->analysisBudget($hasDocuments)['features']);
        } elseif ($assistant->canAnalyse() && $layer['attributeTable']) {
            $statistics = $this->layerStatistics($project, $layer, $assistant->maxFeatures());
        }

        $documents = array('text' => '', 'sources' => array());
        if ($hasDocuments) {
            // The values of the features, to find the documents linked to some values only
            $rows = $sample['records'] ?? array();
            foreach ($statistics['fields'] ?? array() as $field) {
                foreach ($field['top'] ?? array() as $top) {
                    $rows[] = array($field['name'] => $top['value']);
                }
            }
            $documents = (new DocumentContext($documentStore))->forLayer(
                $repository,
                $projectKey,
                $layer['name'],
                $question,
                $rows,
                $assistant->analysisBudget(true)['documents'],
            );
        }

        // The answer can take minutes: release the PHP session lock, so that
        // the other requests of the user (map, tiles, popups) are not blocked
        session_write_close();

        try {
            $rep->data = $assistant->analyse($entry, $statistics, $question, jLocale::getCurrentLocale(), $sample, $documents['text']);
            $rep->data['documents'] = $documents['sources'];
            $rep->data['statistics'] = $statistics;
            $rep->data['features'] = $sample ? array('rows' => $sample['rows'], 'read' => $sample['read']) : null;
            // The feature asked about: found on the map, so that the user can zoom to it
            $rep->data['location'] = null;
            if ($rep->data['feature'] !== '' && $layer['geometryType'] !== 'none') {
                $rep->data['location'] = $this->locateFeatures($project, $layer, $rep->data['feature']);
            }
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
        return new Assistant((new ModulesConfig())->aiConfig());
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
        if (count($requests) >= (new ModulesConfig())->requestsPerHour()) {
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
     * Find the features of a layer having a value, e.g. a name given by the assistant,
     * to zoom to them. Only their number and their extent in EPSG:4326 are given back.
     *
     * @return jResponseJson
     */
    public function locate()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');
        $assistant = $this->getAssistant();
        if (!$assistant->isEnabled()) {
            return $this->error($rep, 404, 'The AI assistant is not enabled');
        }
        if (!$assistant->isAllowed(jAuth::isConnected())) {
            return $this->error($rep, 401, 'User is not connected');
        }
        if (!$this->request->isPostMethod()) {
            return $this->error($rep, 405, 'POST is required');
        }
        $value = trim((string) $this->param('value', ''));
        if ($value === '' || mb_strlen($value) > 200) {
            return $this->error($rep, 400, 'The value must have 1 to 200 characters');
        }
        list($project, $layer) = $this->requestedLayer();
        if (!$layer || $layer['geometryType'] === 'none') {
            return $this->error($rep, 404, 'Unknown layer');
        }
        session_write_close();

        $location = $this->locateFeatures($project, $layer, $value);
        if ($location === null) {
            return $this->error($rep, 404, 'The features of the layer cannot be read');
        }
        $rep->data = $location;

        return $rep;
    }

    /**
     * Read the features of a layer, for both the statistics and the sample sent to the assistant.
     *
     * @param \Lizmap\Project\Project $project   the project
     * @param array                   $layer     the layer, from projectLayers()
     * @param Assistant               $assistant the assistant
     * @param string                  $question  the user question, its features come first
     * @param int                     $maxLength maximum length of the sample table
     *
     * @return array{0: null|array, 1: null|array} the statistics and the sample, null if the layer cannot be read
     */
    protected function layerFeatures($project, $layer, $assistant, $question, $maxLength = 12000)
    {
        $maxFeatures = $assistant->maxFeatures();
        $params = array(
            'SERVICE' => 'WFS',
            'VERSION' => '1.0.0',
            'REQUEST' => 'GetFeature',
            'TYPENAME' => $layer['typeName'],
            'OUTPUTFORMAT' => 'GeoJSON',
            'MAXFEATURES' => (string) $maxFeatures,
        );
        if ($layer['geometryType'] === 'none') {
            $params['GEOMETRYNAME'] = 'none';
        } else {
            $params['SRSNAME'] = 'EPSG:4326';
        }

        try {
            $request = new WFSRequest($project, $params, lizmap::getServices());
            $result = $request->process();
            if ($result->getCode() >= 400 || !str_contains(strtolower($result->getMime()), 'json')) {
                return array(null, null);
            }
            $stream = Psr7StreamWrapper::getResource($result->getBodyAsStream());
            $features = JsonMachineItems::fromStream($stream, array('pointer' => '/features'));
            $statistics = new LayerStatistics();
            $sample = new FeatureSample($question, $assistant->maxRows(), $maxLength);
            foreach ($features as $feature) {
                if ($sample->count() >= $maxFeatures) {
                    break;
                }
                $feature = json_decode(json_encode($feature), true);
                $statistics->add($feature['properties'] ?? array());
                $sample->add($feature);
            }

            return array($statistics->toArray(), $sample->toArray());
        } catch (\Throwable $e) {
            jLog::logEx($e, 'error');

            return array(null, null);
        }
    }

    /**
     * Find the features of a layer having a value.
     *
     * @param \Lizmap\Project\Project $project the project
     * @param array                   $layer   the layer, from projectLayers()
     * @param string                  $value   the value
     *
     * @return null|array the number of features and their extent in EPSG:4326, null if the layer cannot be read
     */
    protected function locateFeatures($project, $layer, $value)
    {
        $maxFeatures = 10000;
        $params = array(
            'SERVICE' => 'WFS',
            'VERSION' => '1.0.0',
            'REQUEST' => 'GetFeature',
            'TYPENAME' => $layer['typeName'],
            'OUTPUTFORMAT' => 'GeoJSON',
            'SRSNAME' => 'EPSG:4326',
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
            $locator = new FeatureLocator($value);
            $locator->addFeatures($features, $maxFeatures);

            return $locator->toArray() + array('crs' => 'EPSG:4326');
        } catch (\Throwable $e) {
            jLog::logEx($e, 'error');

            return null;
        }
    }

    /**
     * The project and the layer given by the request parameters repository, project and layer,
     * if the user can access them.
     *
     * @return array{0: null|\Lizmap\Project\Project, 1: null|array} the project and the layer
     */
    protected function requestedLayer()
    {
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
            return array(null, null);
        }
        foreach ($this->projectLayers($project) as $item) {
            if ($item['name'] === $layerName) {
                return array($project, $item);
            }
        }

        return array($project, null);
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
        $this->error($rep, $code, $e->getMessage());
        // A reason the user interface can explain in simple words
        $rep->data['reason'] = self::errorReason($e->getMessage(), $e->getCode());

        return $rep;
    }

    /**
     * The reason of an assistant error: credit, busy, key, unreachable,
     * timeout, model, refused, config or error.
     *
     * @param string $message the error message
     * @param int    $code    the error code
     *
     * @return string
     */
    public static function errorReason($message, $code)
    {
        $text = strtolower($message);
        $rules = array(
            'credit' => array('credit balance', 'quota', 'billing', 'insufficient'),
            'key' => array('invalid api key', 'api key not valid', 'permission'),
            'busy' => array('overloaded', 'high demand', 'unavailable', 'too many requests'),
            'timeout' => array('timed out', 'curl error 28', 'timeout'),
            'unreachable' => array('cannot be reached', 'could not resolve', 'connection refused'),
            'model' => array('no longer available', 'model not found', 'is not found', 'not supported for'),
            'refused' => array('declined'),
            'config' => array('sdk is not installed', 'not enabled'),
        );
        foreach ($rules as $reason => $words) {
            foreach ($words as $word) {
                if (str_contains($text, $word)) {
                    return $reason;
                }
            }
        }
        if ($code == 429 || $code == 503) {
            return 'busy';
        }

        return 'error';
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
