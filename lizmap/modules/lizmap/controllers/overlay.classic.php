<?php

/**
 * Overlay analysis: the features of the layers of a map intersecting an area
 * drawn by the user, with the area and the share of the area they cover, and
 * their analysis by the AI assistant with the documents linked to them.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

use Lizmap\Ai\Assistant;
use Lizmap\Ai\AssistantException;
use Lizmap\Ai\AssistantJobs;
use Lizmap\Ai\FeatureSample;
use Lizmap\App\ModulesConfig;
use Lizmap\Documents\DocumentContext;
use Lizmap\Documents\DocumentStore;
use Lizmap\Request\OverlayRequest;

class overlayCtrl extends jController
{
    /** Maximum number of layers of an analysis */
    protected const MAX_LAYERS = 60;

    /** Maximum number of features by layer */
    protected const MAX_FEATURES = 500;

    /** Maximum buffer, in meters */
    protected const MAX_BUFFER = 5000;

    /**
     * The features of the layers intersecting the area.
     *
     * Parameters (POST): repository, project, geometries (JSON list of GeoJSON
     * geometries in EPSG:4326), buffer (meters), layers (JSON list of layer names).
     *
     * @return jResponseJson
     */
    public function analyse()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');
        $overlay = $this->overlay();
        if (isset($overlay['error'])) {
            return $this->error($rep, $overlay['error'][0], $overlay['error'][1]);
        }
        $rep->data = $overlay;

        return $rep;
    }

    /**
     * The analysis of the area by the AI assistant.
     *
     * Parameters (POST): the ones of analyse(), and q (question).
     *
     * @return jResponseJson
     */
    public function assistant()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');
        $config = new ModulesConfig();
        $assistant = new Assistant($config->aiConfig());
        if (!$assistant->isEnabled()) {
            return $this->error($rep, 404, 'The AI assistant is not enabled');
        }
        if (!$assistant->isAllowed(jAuth::isConnected())) {
            return $this->error($rep, 401, 'User is not connected');
        }
        if (!$assistant->canSendFeatures()) {
            return $this->error($rep, 403, 'The features cannot be sent to the AI assistant');
        }
        $question = trim((string) $this->param('q', ''));
        if (mb_strlen($question) > 500) {
            return $this->error($rep, 400, 'The question must have at most 500 characters');
        }
        if ($error = $this->countRequest($config)) {
            return $this->error($rep, $error[0], $error[1]);
        }
        // A local model without GPU can take minutes to answer
        set_time_limit(330);

        $overlay = $this->overlay();
        if (isset($overlay['error'])) {
            return $this->error($rep, $overlay['error'][0], $overlay['error'][1]);
        }
        $repository = (string) $this->param('repository');
        $projectKey = (string) $this->param('project');

        // The documents linked to the intersected layers, for the values of their features
        $store = new DocumentStore(jApp::varPath('documents/'));
        $linked = array();
        foreach ($overlay['layers'] as $layer) {
            if ($layer['features'] && $store->linksOf($repository, $projectKey, $layer['name'])) {
                $linked[] = $layer;
            }
        }
        $budget = $assistant->areaBudget();
        $intersected = array_values(array_filter($overlay['layers'], static function ($layer) {
            return count($layer['features']) > 0;
        }));

        $layers = array();
        foreach ($overlay['layers'] as $layer) {
            if ($layer['status'] !== 'ok') {
                continue;
            }
            $sample = new FeatureSample($question, $assistant->maxRows(), (int) max(600, $budget['features'] / max(1, count($intersected))));
            foreach ($layer['features'] as $feature) {
                $sample->add(array('properties' => self::featureRow($layer, $feature)));
            }
            $table = $sample->toArray();
            $layers[] = array(
                'title' => $layer['title'],
                'table' => $table['table'],
                'rows' => $table['rows'],
                'count' => count($layer['features']),
                'truncated' => $layer['truncated'],
            );
        }

        $documents = array('text' => '', 'sources' => array());
        if ($linked) {
            $context = new DocumentContext($store);
            $length = (int) ($budget['documents'] / count($linked));
            $texts = array();
            foreach ($linked as $layer) {
                $rows = array_map(static function ($feature) {
                    return $feature['properties'];
                }, $layer['features']);
                $result = $context->forLayer($repository, $projectKey, $layer['name'], $question, $rows, $length);
                if ($result['text'] !== '') {
                    $texts[] = $result['text'];
                    $documents['sources'] = array_merge($documents['sources'], $result['sources']);
                }
            }
            $documents['text'] = implode("\n\n", $texts);
        }

        // The answer can take minutes: release the PHP session lock
        $owner = session_id();
        session_write_close();
        $language = jLocale::getCurrentLocale();
        $run = static function () use ($assistant, $overlay, $layers, $question, $language, $documents) {
            $start = microtime(true);

            try {
                $data = $assistant->analyseArea(
                    array('area' => $overlay['area']['area'], 'buffer' => $overlay['buffer'], 'map' => $overlay['map']),
                    $layers,
                    $question,
                    $language,
                    $documents['text'],
                );
                $data['documents'] = $documents['sources'];
                jLog::log(sprintf(
                    'AI assistant overlay analysis: %d layers, %d characters of features and %d of documents, answer in %.1f s (%s)',
                    count($layers),
                    array_sum(array_map(static function ($layer) {
                        return mb_strlen($layer['table']);
                    }, $layers)),
                    mb_strlen($documents['text']),
                    microtime(true) - $start,
                    $assistant->lastAnswerInfo(),
                ), 'lizmapadmin');

                return $data;
            } catch (AssistantException $e) {
                jLog::log(sprintf('AI assistant overlay analysis failed after %.1f s: %s', microtime(true) - $start, $e->getMessage()), 'lizmapadmin');

                return array(
                    'error' => $e->getMessage(),
                    'code' => $e->getCode() >= 400 ? $e->getCode() : 502,
                    'reason' => Assistant::errorReason($e->getMessage(), $e->getCode()),
                );
            }
        };

        // In the background: a proxy or the web server would cut a long request
        if ($this->param('async') && $owner !== '') {
            $jobs = new AssistantJobs(jApp::tempPath('aijobs/'));
            $id = $jobs->create($owner);
            $work = static function () use ($jobs, $id, $run) {
                try {
                    $jobs->finish($id, $run());
                } catch (\Throwable $e) {
                    $jobs->finish($id, array('error' => $e->getMessage(), 'code' => 500, 'reason' => 'error'));
                }
            };
            if (AssistantJobs::canRunInBackground()) {
                // PHP-FPM: send the response with the job id, then compute the answer
                register_shutdown_function(static function () use ($work) {
                    ignore_user_abort(true);
                    set_time_limit(330);
                    fastcgi_finish_request();
                    $work();
                });
                $rep->data = array('job' => $id);

                return $rep;
            }
            // Apache mod_php: send the response and close the connection, then compute the answer
            AssistantJobs::sendAndClose(json_encode(array('job' => $id)));
            $work();

            exit(0);
        }

        $data = $run();
        if (isset($data['error'])) {
            $this->error($rep, $data['code'], $data['error']);
            $rep->data['reason'] = $data['reason'];
        } else {
            $rep->data = $data;
        }

        return $rep;
    }

    /**
     * The state of an analysis computed in the background, and its answer when ready.
     *
     * Parameter: id (the job id given by assistant()).
     *
     * @return jResponseJson
     */
    public function job()
    {
        /** @var jResponseJson $rep */
        $rep = $this->getResponse('json');
        $owner = session_id();
        session_write_close();
        $job = $owner !== '' ? (new AssistantJobs(jApp::tempPath('aijobs/')))->read((string) $this->param('id'), $owner) : null;
        if ($job === null) {
            return $this->error($rep, 404, 'Unknown analysis');
        }
        if ($job['state'] === 'running') {
            // Not answered after the time limit: the background process has stopped
            if ($job['started'] < time() - 360) {
                $this->error($rep, 504, 'The AI service took too long to answer (timeout)');
                $rep->data['reason'] = 'timeout';

                return $rep;
            }
            $rep->data = array('state' => 'running', 'elapsed' => time() - $job['started']);

            return $rep;
        }
        $data = $job['data'];
        if ($job['state'] === 'error') {
            $this->error($rep, $data['code'] ?? 502, $data['error'] ?? 'Error');
            $rep->data['reason'] = $data['reason'] ?? 'error';

            return $rep;
        }
        $rep->data = array('state' => 'done') + $data;

        return $rep;
    }

    /**
     * A feature as a row for the assistant: its attributes, with their aliases, and the measures.
     *
     * @param array $layer   the layer, from overlay()
     * @param array $feature the feature
     *
     * @return array<string, mixed>
     */
    protected static function featureRow(array $layer, array $feature)
    {
        $row = array();
        foreach ($layer['fields'] as $field) {
            $row[$field['alias']] = $feature['properties'][$field['name']] ?? null;
        }
        if ($feature['area'] !== null) {
            $row['area_m2'] = $feature['area'];
            $row['percent'] = $feature['percent'];
        } elseif ($feature['length'] !== null) {
            $row['length_m'] = $feature['length'];
        }

        return $row;
    }

    /**
     * The overlay of the requested area and layers.
     *
     * @return array the area and the layers, or error: [HTTP code, message]
     */
    protected function overlay()
    {
        if (!(new ModulesConfig())->isEnabled('overlay')) {
            return array('error' => array(404, 'The overlay analysis is not enabled'));
        }
        if (!$this->request->isPostMethod()) {
            return array('error' => array(405, 'POST is required'));
        }
        $repository = (string) $this->param('repository');
        $projectKey = (string) $this->param('project');
        $project = null;
        if ($repository !== '' && $projectKey !== '') {
            try {
                $project = lizmap::getProject($repository.'~'.$projectKey);
            } catch (\Exception $e) {
                $project = null;
            }
        }
        if (!$project || !$project->checkAcl()) {
            return array('error' => array(404, 'Unknown project'));
        }

        $geometries = json_decode((string) $this->param('geometries', '[]'), true);
        if (!is_array($geometries) || count($geometries) === 0 || count($geometries) > 50) {
            return array('error' => array(400, 'Draw the area first'));
        }
        foreach ($geometries as $geometry) {
            if (!is_array($geometry) || !is_string($geometry['type'] ?? null) || !is_array($geometry['coordinates'] ?? null)) {
                return array('error' => array(400, 'Invalid geometry'));
            }
        }
        $buffer = (float) $this->param('buffer', 0);
        if ($buffer < 0 || $buffer > self::MAX_BUFFER) {
            return array('error' => array(400, 'The buffer must be between 0 and '.self::MAX_BUFFER.' m'));
        }
        $names = json_decode((string) $this->param('layers', '[]'), true);
        if (!is_array($names) || count($names) === 0 || count($names) > self::MAX_LAYERS) {
            return array('error' => array(400, 'Choose 1 to '.self::MAX_LAYERS.' layers'));
        }

        // The layers, in the requested order
        $config = $project->getUpdatedConfig();
        $layers = array();
        foreach (array_unique(array_map('strval', $names)) as $name) {
            if (!property_exists($config->layers, $name)) {
                continue;
            }
            $layerConfig = $config->layers->{$name};
            $layers[] = array(
                'name' => $name,
                'title' => $layerConfig->title ?? $name,
                'typeName' => str_replace(' ', '_', (property_exists($layerConfig, 'shortname') && $layerConfig->shortname) ? $layerConfig->shortname : $name),
            );
        }

        // The area, computed by PostGIS with the connection of a PostgreSQL layer
        $area = null;
        foreach ($layers as $layer) {
            $layerConfig = $project->findLayerByName($layer['name']);
            $qgisLayer = $layerConfig ? $project->getLayer($layerConfig->id) : null;
            if ($qgisLayer instanceof qgisVectorLayer && $qgisLayer->getProvider() === 'postgres') {
                try {
                    $area = OverlayRequest::area($qgisLayer->getDatasourceConnection(), $geometries, $buffer);
                } catch (\Exception $e) {
                    jLog::logEx($e, 'error');

                    return array('error' => array(400, 'Invalid geometry'));
                }

                break;
            }
        }
        if ($area === null) {
            return array('error' => array(400, 'None of the chosen layers is a PostgreSQL layer'));
        }

        // The analysis is long for a big area: release the PHP session lock
        session_write_close();
        $results = array();
        foreach ($layers as $layer) {
            $request = new OverlayRequest($project, array(
                'SERVICE' => 'WFS',
                'VERSION' => '1.0.0',
                'REQUEST' => 'GetFeature',
                'TYPENAME' => $layer['typeName'],
                'OUTPUTFORMAT' => 'GeoJSON',
            ), lizmap::getServices());

            try {
                $result = $request->intersect($area, self::MAX_FEATURES);
            } catch (\Exception $e) {
                jLog::logEx($e, 'error');
                $result = array('status' => 'error');
            }
            $results[] = array(
                'name' => $layer['name'],
                'title' => $layer['title'],
                'status' => $result['status'],
                'fields' => $result['fields'] ?? array(),
                'features' => $result['features'] ?? array(),
                'truncated' => $result['truncated'] ?? false,
            );
        }

        return array(
            'map' => $project->getTitle(),
            'buffer' => $buffer,
            'area' => array(
                'geometry' => json_decode($area['geometry'], true),
                'area' => round($area['area'], 2),
                'extent' => $area['extent'],
            ),
            'layers' => $results,
        );
    }

    /**
     * Count the requests to the assistant: a number of requests by hour and user session.
     *
     * @param ModulesConfig $config
     *
     * @return null|array{int, string} the HTTP error, or null
     */
    protected function countRequest($config)
    {
        $now = time();
        $requests = array_filter(
            $_SESSION['lizmapAiRequests'] ?? array(),
            static function ($time) use ($now) {
                return $time > $now - 3600;
            }
        );
        if (count($requests) >= $config->requestsPerHour()) {
            return array(429, 'Too many requests to the AI assistant, try again later');
        }
        $requests[] = $now;
        $_SESSION['lizmapAiRequests'] = array_values($requests);

        return null;
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
