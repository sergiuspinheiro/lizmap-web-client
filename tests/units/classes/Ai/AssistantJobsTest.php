<?php

use Lizmap\Ai\AssistantJobs;
use PHPUnit\Framework\TestCase;

/**
 * @internal
 *
 * @coversNothing
 */
class AssistantJobsTest extends TestCase
{
    public function testJobs()
    {
        $dir = sys_get_temp_dir().'/lizmap-ai-jobs-'.bin2hex(random_bytes(4));
        $jobs = new AssistantJobs($dir);
        $id = $jobs->create('session-a');
        $this->assertEquals(32, strlen($id));
        $this->assertEquals('running', $jobs->read($id, 'session-a')['state']);
        // Another session cannot read it
        $this->assertNull($jobs->read($id, 'session-b'));
        $this->assertNull($jobs->read('../etc/passwd', 'session-a'));

        $jobs->finish($id, array('answer' => 'Espaço urbano'));
        $job = $jobs->read($id, 'session-a');
        $this->assertEquals('done', $job['state']);
        $this->assertEquals('Espaço urbano', $job['data']['answer']);
        $this->assertArrayNotHasKey('owner', $job);

        $other = $jobs->create('session-a');
        $jobs->finish($other, array('error' => 'timeout', 'code' => 504));
        $this->assertEquals('error', $jobs->read($other, 'session-a')['state']);

        array_map('unlink', glob($dir.'/*'));
        rmdir($dir);
    }
}
