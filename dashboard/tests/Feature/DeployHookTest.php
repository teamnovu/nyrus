<?php

namespace Tests\Feature;

use App\Http\Controllers\DeployHookController;
use Tests\TestCase;

class DeployHookTest extends TestCase
{
    private string $file;

    protected function setUp(): void
    {
        parent::setUp();
        $this->file = storage_path(DeployHookController::TOKEN_FILE);
        @unlink($this->file);
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
        parent::tearDown();
    }

    public function test_valid_token_resets_and_is_used_once(): void
    {
        file_put_contents($this->file, "abc123\n");

        $this->post('/_deploy/opcache-reset', [], ['X-Deploy-Token' => 'abc123'])
            ->assertOk()
            ->assertJsonStructure(['opcacheReset']);

        $this->assertFileDoesNotExist($this->file);
        $this->post('/_deploy/opcache-reset', [], ['X-Deploy-Token' => 'abc123'])->assertNotFound();
    }

    public function test_wrong_missing_or_stale_token_is_rejected(): void
    {
        $this->post('/_deploy/opcache-reset', [], ['X-Deploy-Token' => 'abc123'])->assertNotFound();

        file_put_contents($this->file, 'abc123');
        $this->post('/_deploy/opcache-reset', [], ['X-Deploy-Token' => 'nope'])->assertNotFound();
        $this->post('/_deploy/opcache-reset')->assertNotFound();

        touch($this->file, time() - 3600);
        $this->post('/_deploy/opcache-reset', [], ['X-Deploy-Token' => 'abc123'])->assertNotFound();
        $this->assertFileExists($this->file);
    }
}
