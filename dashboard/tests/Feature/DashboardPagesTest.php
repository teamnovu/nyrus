<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\NyrusClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class DashboardPagesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['nyrus.url' => 'http://nyrus.test', 'nyrus.api_key' => 'secret-key']);
        $this->app->forgetInstance(NyrusClient::class);
        $this->actingAs(User::factory()->create(['email' => 'robin@novu.ch']));
    }

    private function sessionData(array $overrides = []): array
    {
        return array_replace_recursive([
            'id' => 's1',
            'status' => 'active',
            'createdAt' => 1_700_000_000_000,
            'updatedAt' => 1_700_000_100_000,
            'tracker' => 'clickup',
            'issue' => ['id' => 'c1', 'identifier' => 'CU-42', 'title' => 'Fix the login'],
            'repositories' => [['id' => 'web', 'branch' => 'cu-42']],
            'workspacePath' => '/home/forge/.cyrus/worktrees/cu-42',
            'model' => 'opus',
            'totalCostUsd' => 1.25,
            'entryCount' => 1,
            'lastActivityAt' => 1_700_000_100_000,
            'pullRequestUrl' => 'https://github.com/teamnovu/web/pull/9',
        ], $overrides);
    }

    public function test_overview_shows_status_and_sessions(): void
    {
        Http::fake([
            'nyrus.test/status' => Http::response(['status' => 'busy']),
            'nyrus.test/version' => Http::response(['cyrus_cli_version' => '0.2.78']),
            'nyrus.test/api/dashboard/sessions' => Http::response(['success' => true, 'data' => ['sessions' => [$this->sessionData()]]]),
        ]);

        $this->get('/')
            ->assertOk()
            ->assertSee('beschäftigt')
            ->assertSee('0.2.78')
            ->assertSee('CU-42')
            ->assertSee('Fix the login')
            ->assertSee('https://github.com/teamnovu/web/pull/9');

        Http::assertSent(fn (Request $request) => $request->url() === 'http://nyrus.test/api/dashboard/sessions'
            && $request->hasHeader('Authorization', 'Bearer secret-key'));
    }

    private function fakeSessions(array $sessions): void
    {
        Http::fake([
            'nyrus.test/status' => Http::response(['status' => 'busy']),
            'nyrus.test/version' => Http::response(['cyrus_cli_version' => '0.2.78']),
            'nyrus.test/api/dashboard/sessions' => Http::response(['success' => true, 'data' => ['sessions' => $sessions]]),
        ]);
    }

    public function test_overview_lists_sessions_from_every_source(): void
    {
        $this->fakeSessions([
            $this->sessionData(['id' => 'slack-ev-1', 'source' => 'slack', 'state' => 'running', 'tracker' => null, 'issue' => ['identifier' => null, 'title' => null], 'title' => 'Why is CI red?', 'runner' => 'codex', 'model' => 'gpt-5', 'repositories' => []]),
            $this->sessionData(['id' => 'github-d1', 'source' => 'github-pr', 'state' => 'finished', 'status' => 'complete', 'issue' => ['identifier' => 'web#12', 'title' => 'Add login']]),
            $this->sessionData(['id' => 'old', 'source' => 'zulip', 'state' => 'stale', 'status' => 'stale', 'live' => false, 'issue' => ['identifier' => null, 'title' => null], 'title' => 'Hello']),
        ]);

        $this->get('/')
            ->assertOk()
            ->assertSee('Why is CI red?')
            ->assertSee('codex · gpt-5')
            ->assertSee('GitHub PR')
            ->assertSee('web#12')
            ->assertSee('Zulip')
            ->assertSee('unterbrochen')
            ->assertSee('3 Sessions')
            ->assertDontSee('<details', false);
    }

    public function test_overview_filters_by_source_and_status(): void
    {
        $this->fakeSessions([
            $this->sessionData(['id' => 's1', 'source' => 'slack', 'state' => 'running', 'issue' => ['identifier' => 'SLACK-ONE']]),
            $this->sessionData(['id' => 's2', 'source' => 'jira', 'state' => 'failed', 'status' => 'error', 'issue' => ['identifier' => 'JIRA-TWO']]),
            $this->sessionData(['id' => 's3', 'source' => 'jira', 'state' => 'finished', 'status' => 'complete', 'issue' => ['identifier' => 'JIRA-THREE']]),
        ]);

        $this->get('/?source=jira')
            ->assertOk()->assertSee('JIRA-TWO')->assertSee('JIRA-THREE')->assertDontSee('SLACK-ONE')->assertSee('2 von 3 Sessions');

        $this->get('/?source=jira&status=failed')
            ->assertOk()->assertSee('JIRA-TWO')->assertDontSee('JIRA-THREE')->assertDontSee('SLACK-ONE');

        // unknown values are ignored
        $this->get('/?source=nope&status=nope')->assertOk()->assertSee('SLACK-ONE')->assertSee('3 Sessions');
    }

    public function test_overview_derives_source_and_status_from_older_nyrus(): void
    {
        $this->fakeSessions([
            $this->sessionData(['id' => 'a', 'tracker' => 'github', 'status' => 'awaitingInput', 'issue' => ['identifier' => 'OLD-PR']]),
            $this->sessionData(['id' => 'b', 'tracker' => 'clickup', 'status' => 'active', 'issue' => ['identifier' => 'OLD-CU']]),
        ]);

        $this->get('/?source=github-pr&status=waiting')->assertOk()->assertSee('OLD-PR')->assertDontSee('OLD-CU');
    }

    public function test_overview_paginates_long_lists(): void
    {
        $sessions = [];
        for ($i = 1; $i <= 60; $i++) {
            $sessions[] = $this->sessionData(['id' => "s{$i}", 'issue' => ['identifier' => sprintf('T-%03d', $i)]]);
        }
        $this->fakeSessions($sessions);

        $this->get('/')->assertOk()->assertSee('T-050')->assertDontSee('T-051')->assertSee('1–50 angezeigt');
        $this->get('/?page=2')->assertOk()->assertSee('T-060')->assertDontSee('T-050')->assertSee('51–60 angezeigt');
    }

    public function test_overview_survives_nyrus_being_down(): void
    {
        Http::fake(fn () => throw new ConnectionException('refused'));

        $this->get('/')->assertOk()->assertSee('nicht erreichbar')->assertSee('Sessions konnten nicht geladen werden');
    }

    public function test_overview_explains_a_wrong_api_key(): void
    {
        Http::fake([
            'nyrus.test/status' => Http::response(['status' => 'idle']),
            'nyrus.test/version' => Http::response(['cyrus_cli_version' => '0.2.78']),
            'nyrus.test/api/*' => Http::response(['success' => false, 'error' => 'Unauthorized'], 401),
        ]);

        $this->get('/')->assertOk()->assertSee('NYRUS_API_KEY must match CYRUS_API_KEY');
    }

    public function test_session_detail_shows_entries(): void
    {
        Http::fake([
            'nyrus.test/api/dashboard/session*' => Http::response(['success' => true, 'data' => [
                'session' => $this->sessionData(),
                'entries' => [['type' => 'assistant', 'content' => 'Running the tests now', 'toolName' => 'Bash', 'isError' => false, 'timestamp' => 1_700_000_050_000]],
            ]]),
        ]);

        $this->get('/sessions/s1')->assertOk()->assertSee('CU-42')->assertSee('Running the tests now')->assertSee('$1.25', false);

        Http::assertSent(fn (Request $request) => str_contains($request->url(), '/api/dashboard/session?id=s1'));
    }

    public function test_session_detail_of_a_past_session_without_entries(): void
    {
        Http::fake([
            'nyrus.test/api/dashboard/session*' => Http::response(['success' => true, 'data' => [
                'session' => $this->sessionData(['id' => 'slack-ev-1', 'source' => 'slack', 'status' => 'stale', 'live' => false, 'issue' => ['identifier' => null, 'title' => null], 'title' => 'Why is CI red?', 'parentSessionId' => 'p1']),
                'entries' => [],
            ]]),
        ]);

        $this->get('/sessions/slack-ev-1')
            ->assertOk()
            ->assertSee('Why is CI red?')
            ->assertSee('Slack')
            ->assertSee('unterbrochen')
            ->assertSee('Verlauf nicht mehr gespeichert.')
            ->assertSee('/sessions/p1', false);
    }

    public function test_failed_add_shows_nyrus_error_and_is_logged(): void
    {
        Http::fake([
            'nyrus.test/api/dashboard/repository' => Http::response(['success' => false, 'error' => 'Failed to clone repository', 'details' => 'no access'], 400),
        ]);

        $this->from('/repositories')
            ->post('/repositories', ['repository_url' => 'https://github.com/teamnovu/secret.git'])
            ->assertRedirect('/repositories')
            ->assertSessionHas('error', 'Failed to clone repository no access');

        $this->assertDatabaseHas('audit_logs', ['action' => 'repository.add', 'success' => false]);
    }

    public function test_repository_url_must_be_https_or_ssh(): void
    {
        Http::fake();
        $this->post('/repositories', ['repository_url' => 'file:///etc/passwd'])->assertSessionHasErrors('repository_url');
        Http::assertNothingSent();
    }

    public function test_routing_update_and_removal(): void
    {
        Http::fake(['nyrus.test/api/dashboard/repository*' => Http::response(['success' => true, 'message' => 'ok', 'data' => []])]);

        $this->put('/repositories/web', [
            'baseBranch' => 'main',
            'teamKeys' => 'WEB',
            'projectKeys' => '',
            'routingLabels' => 'frontend',
            'isActive' => '0',
        ])->assertRedirect('/repositories');

        Http::assertSent(fn (Request $request) => $request->url() === 'http://nyrus.test/api/dashboard/repository/routing'
            && $request['name'] === 'web'
            && $request['isActive'] === false
            && $request['teamKeys'] === ['WEB']
            && $request['routingLabels'] === ['frontend']);

        $this->delete('/repositories/web', ['deleteFiles' => '1'])->assertRedirect('/repositories');

        Http::assertSent(fn (Request $request) => $request->method() === 'DELETE'
            && $request['name'] === 'web'
            && $request['deleteFiles'] === true);
    }

    public function test_settings_show_keys_and_never_values(): void
    {
        Http::fake([
            'nyrus.test/api/dashboard/env' => Http::response(['success' => true, 'data' => ['exists' => true, 'keys' => [
                ['key' => 'GITHUB_TOKEN', 'hasValue' => true],
                ['key' => 'ANTHROPIC_API_KEY', 'hasValue' => false],
            ]]]),
            'nyrus.test/api/check-gh' => Http::response(['success' => true, 'data' => ['isInstalled' => true, 'isAuthenticated' => false]]),
        ]);

        $this->get('/settings')
            ->assertOk()
            ->assertSee('GITHUB_TOKEN')
            ->assertSee('gesetzt')
            ->assertSee('gh auth login');
    }

    public function test_setting_a_variable_logs_only_the_key(): void
    {
        Http::fake(['nyrus.test/api/update/cyrus-env' => Http::response(['success' => true, 'message' => 'ok', 'data' => []])]);

        $this->post('/settings', ['key' => 'GITHUB_TOKEN', 'value' => 'ghp_supersecret'])->assertRedirect('/settings');

        Http::assertSent(fn (Request $request) => $request['variables'] === ['GITHUB_TOKEN' => 'ghp_supersecret']);
        $log = AuditLog::firstWhere('action', 'env.set');
        $this->assertSame('GITHUB_TOKEN', $log->subject);
        $this->assertStringNotContainsString('ghp_supersecret', json_encode($log->toArray()));
    }

    public function test_protected_variables_cannot_be_changed(): void
    {
        Http::fake();

        $this->post('/settings', ['key' => 'CYRUS_API_KEY', 'value' => 'x'])->assertSessionHas('error');
        $this->post('/settings', ['key' => 'lower_case', 'value' => 'x'])->assertSessionHasErrors('key');
        $this->post('/settings', ['key' => 'GITHUB_TOKEN', 'value' => "a\nEVIL=1"])->assertSessionHasErrors('value');

        Http::assertNothingSent();
    }

    public function test_logs_show_the_end_of_the_file_and_filter_by_level(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'nyrus-log');
        file_put_contents($path, implode("\n", [
            '2026-11-13T11:58:10Z [INFO ] [CLI] Server running on port 3456',
            '2026-11-13T11:58:11Z [WARN ] [EdgeWorker] No repositories configured',
            '2026-11-13T11:58:12Z [ERROR] [EdgeWorker] Something broke',
        ])."\n");
        config(['nyrus.log_path' => $path]);

        $this->get('/logs')->assertOk()->assertSee('Server running on port 3456')->assertSee('Something broke');
        $this->get('/logs?level=error')->assertOk()->assertSee('Something broke')->assertDontSee('Server running on port 3456');

        unlink($path);
    }

    public function test_log_tail_returns_only_new_complete_lines(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'nyrus-log');
        file_put_contents($path, "2026-11-13T11:58:10Z [INFO ] [CLI] First line\n");
        config(['nyrus.log_path' => $path]);

        $first = $this->getJson('/logs/tail')->assertOk()->assertJson(['reset' => false, 'count' => 1]);
        $offset = $first->json('offset');
        $this->assertSame(filesize($path), $offset);
        $this->assertStringContainsString('First line', $first->json('html'));

        // a complete new line and one still being written
        file_put_contents($path, "2026-11-13T11:58:11Z [ERROR] [EdgeWorker] Second line\n2026-11-13T11:58:12Z [INFO ] half", FILE_APPEND);
        $next = $this->getJson("/logs/tail?offset={$offset}")->assertOk()->assertJson(['reset' => false, 'count' => 1]);
        $this->assertStringContainsString('Second line', $next->json('html'));
        $this->assertStringNotContainsString('First line', $next->json('html'));
        $this->assertStringNotContainsString('half', $next->json('html'));

        // filtered by level
        $this->getJson("/logs/tail?offset={$offset}&level=info")->assertJson(['count' => 0]);

        // truncated (e.g. rotated): start over
        file_put_contents($path, "2026-11-13T12:00:00Z [INFO ] [CLI] Fresh\n");
        $this->getJson('/logs/tail?offset=999999')->assertOk()->assertJson(['reset' => true, 'count' => 1]);

        unlink($path);
    }

    public function test_log_tail_reports_missing_configuration(): void
    {
        config(['nyrus.log_path' => null]);
        $this->getJson('/logs/tail')->assertStatus(503)->assertJsonStructure(['error']);
    }

    public function test_logs_explain_missing_configuration(): void
    {
        config(['nyrus.log_path' => null]);
        $this->get('/logs')->assertOk()->assertSee('NYRUS_LOG_PATH ist nicht gesetzt');
    }

    public function test_audit_log_lists_changes(): void
    {
        AuditLog::record('repository.add', 'web');
        $this->get('/audit')->assertOk()->assertSee('repository.add')->assertSee('web');
    }
}
