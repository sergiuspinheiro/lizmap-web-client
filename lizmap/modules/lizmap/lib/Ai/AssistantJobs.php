<?php

/**
 * Requests to the AI assistant answered in the background: the browser gets an
 * id at once, then asks for the answer until it is ready, so that a slow local
 * model is not cut by the timeout of a proxy or of the web server.
 *
 * @author    3liz
 * @copyright 2026 3liz
 *
 * @see      http://3liz.com
 *
 * @license Mozilla Public License : http://www.mozilla.org/MPL/
 */

namespace Lizmap\Ai;

class AssistantJobs
{
    /** Time after which a job is deleted, in seconds */
    public const LIFETIME = 3600;

    /** @var string the directory of the jobs */
    protected $dir;

    /**
     * @param string $dir the directory of the jobs
     */
    public function __construct($dir)
    {
        $this->dir = rtrim($dir, '/').'/';
    }

    /**
     * Can the answer be computed after the response is sent (PHP-FPM).
     *
     * @return bool
     */
    public static function canRunInBackground()
    {
        return function_exists('fastcgi_finish_request');
    }

    /**
     * Create a job.
     *
     * @param string $owner the owner of the job, e.g. the session id: only the owner reads it
     *
     * @return string the job id
     */
    public function create($owner)
    {
        $this->cleanup();
        if (!is_dir($this->dir)) {
            @mkdir($this->dir, 0775, true);
        }
        $id = bin2hex(random_bytes(16));
        $this->write($id, array('owner' => hash('sha256', (string) $owner), 'state' => 'running', 'started' => time()));

        return $id;
    }

    /**
     * Save the answer of a job.
     *
     * @param string $id   the job id
     * @param array  $data the answer, or an error: error, code, reason
     */
    public function finish($id, array $data)
    {
        $job = $this->load($id);
        if ($job === null) {
            return;
        }
        $job['state'] = isset($data['error']) ? 'error' : 'done';
        $job['data'] = $data;
        $this->write($id, $job);
    }

    /**
     * Read a job.
     *
     * @param string $id    the job id
     * @param string $owner the owner of the job
     *
     * @return null|array{state: string, data?: array, started: int} null if unknown or not owned
     */
    public function read($id, $owner)
    {
        $job = $this->load($id);
        if ($job === null || !hash_equals($job['owner'], hash('sha256', (string) $owner))) {
            return null;
        }
        unset($job['owner']);

        return $job;
    }

    /**
     * @param string $id the job id
     *
     * @return null|array the job
     */
    protected function load($id)
    {
        if (!preg_match('/^[0-9a-f]{32}$/', (string) $id) || !is_file($this->dir.$id.'.json')) {
            return null;
        }
        $job = json_decode((string) file_get_contents($this->dir.$id.'.json'), true);

        return is_array($job) && isset($job['owner']) ? $job : null;
    }

    protected function write($id, array $job)
    {
        $file = $this->dir.$id.'.json';
        file_put_contents($file.'.tmp', json_encode($job, JSON_UNESCAPED_UNICODE));
        rename($file.'.tmp', $file);
    }

    /**
     * Delete the old jobs.
     */
    protected function cleanup()
    {
        foreach (glob($this->dir.'*.json') ?: array() as $file) {
            if (filemtime($file) < time() - self::LIFETIME) {
                @unlink($file);
            }
        }
    }
}
