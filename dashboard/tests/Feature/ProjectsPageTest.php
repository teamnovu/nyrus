<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\NyrusClient;
use App\Services\ProjectOverview;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/** The "Projekte" page: one row per GitHub repository, its detail page and the inBudget report. */
class ProjectsPageTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['nyrus.url' => 'http://nyrus.test', 'nyrus.api_key' => 'secret-key']);
        $this->app->forgetInstance(NyrusClient::class);
        $this->actingAs(User::factory()->create(['email' => 'robin@novu.ch']));
    }

    /** Fake nyrus with the given config entries and (optionally) an inBudget status. */
    private function fakeNyrus(array $repositories, ?array $inbudget = null, ?array $manualStatus = null): void
    {
        Http::fake([
            'nyrus.test/api/dashboard/config' => Http::response(['success' => true, 'data' => ['repositories' => $repositories, 'settingKeys' => []]]),
            'nyrus.test/api/dashboard/inbudget/manual' => Http::response(['success' => true, 'data' => ['status' => $manualStatus ?? ($inbudget ?? [])]]),
            'nyrus.test/api/dashboard/inbudget' => $inbudget === null
                ? Http::response('Not Found', 404)
                : Http::response(['success' => true, 'data' => ['status' => $inbudget]]),
            'nyrus.test/api/dashboard/repository*' => Http::response(['success' => true, 'message' => 'ok', 'data' => []]),
        ]);
    }

    private function keys(array $team = [], array $project = []): array
    {
        return ['teamKeys' => $team, 'projectKeys' => $project];
    }

    /** inBudget knows teamnovu/sayflowers (Jira SAY from inBudget) and teamnovu/intern (no tracker at all). */
    private function sayflowersStatus(array $jira = [], array $clickup = []): array
    {
        return [
            'running' => false,
            'lastSuccessAt' => '2026-11-14T09:30:00.000Z',
            'projectCount' => 2,
            'trackers' => ['jira' => true, 'clickup' => true, 'github' => true],
            'repos' => [
                [
                    'repo' => 'teamnovu/SayFlowers',
                    'projects' => ['P-22093 sayflowers.ch (SayFlowers Concepts GmbH)'],
                    'branch' => 'main',
                    'platforms' => [
                        'jira' => $jira + ['inbudget' => $this->keys(['SAY']), 'manual' => $this->keys(), 'effective' => $this->keys(['SAY']), 'entryId' => 'inbudget-sayflowers-jira'],
                        'clickup' => $clickup + ['inbudget' => $this->keys(), 'manual' => $this->keys(), 'effective' => $this->keys()],
                        'github' => ['entryId' => 'inbudget-sayflowers-github'],
                    ],
                ],
                [
                    'repo' => 'teamnovu/intern',
                    'projects' => ['P-1000 Intern (novu)'],
                    'platforms' => [
                        'jira' => ['inbudget' => $this->keys(), 'manual' => $this->keys(), 'effective' => $this->keys()],
                        'clickup' => ['inbudget' => $this->keys(), 'manual' => $this->keys(), 'effective' => $this->keys()],
                    ],
                ],
            ],
        ];
    }

    private function sayflowersEntries(): array
    {
        return [
            ['id' => 'inbudget-sayflowers-jira', 'name' => 'inbudget-sayflowers-jira', 'githubUrl' => 'https://github.com/teamnovu/SayFlowers',
                'linearWorkspaceId' => 'jira-novu', 'teamKeys' => ['SAY'], 'baseBranch' => 'main', 'repositoryPath' => '/r/sayflowers'],
            ['id' => 'inbudget-sayflowers-github', 'name' => 'inbudget-sayflowers-github', 'githubUrl' => 'https://github.com/teamnovu/SayFlowers',
                'linearWorkspaceId' => 'github', 'teamKeys' => ['teamnovu/sayflowers'], 'baseBranch' => 'main', 'repositoryPath' => '/r/sayflowers'],
            // added by hand for the same repository (other spelling of the URL)
            ['id' => 'sayflowers-labels', 'name' => 'sayflowers-labels', 'githubUrl' => 'git@github.com:teamnovu/sayflowers.git',
                'linearWorkspaceId' => 'clickup-123', 'teamKeys' => ['9015'], 'projectKeys' => ['Website'], 'isActive' => false, 'repositoryPath' => '/r/sayflowers-2'],
            ['id' => 'web', 'name' => 'web', 'githubUrl' => 'https://github.com/teamnovu/web', 'linearWorkspaceId' => 'jira-novu', 'teamKeys' => ['WEB'], 'repositoryPath' => '/r/web'],
        ];
    }

    private function sorted(array $data): array
    {
        ksort($data);

        return $data;
    }

    private function assertNoCollapsibles(TestResponse $response): void
    {
        $this->assertStringNotContainsString('<details', $response->getContent());
        $this->assertStringNotContainsString('<summary', $response->getContent());
    }

    /** Form fields and forms on a page only inside <dialog>s (every change: button + modal). */
    private function assertFormsOnlyInModals(TestResponse $response): void
    {
        preg_match('~<main.*</main>~s', $response->getContent(), $main);
        $outside = preg_replace('~<dialog\b.*?</dialog>~s', '', $main[0]);
        foreach (['<form', '<input', '<select', '<textarea'] as $tag) {
            $this->assertStringNotContainsString($tag, $outside, "{$tag} outside a modal");
        }
    }

    /** The HTML of one modal (<dialog id="…">). */
    private function modal(TestResponse $response, string $id): string
    {
        $this->assertMatchesRegularExpression('~<dialog id="'.preg_quote($id, '~').'"~', $response->getContent());
        preg_match('~<dialog id="'.preg_quote($id, '~').'".*?</dialog>~s', $response->getContent(), $m);

        return $m[0];
    }

    /** The HTML of one tracker section on the detail page. */
    private function trackerSection(TestResponse $response, string $platform): string
    {
        $this->assertMatchesRegularExpression('~data-tracker="'.$platform.'"~', $response->getContent());
        preg_match('~data-tracker="'.$platform.'".*?</section>~s', $response->getContent(), $m);

        return $m[0];
    }

    public function test_entries_of_one_repository_are_one_row(): void
    {
        $this->fakeNyrus($this->sayflowersEntries(), $this->sayflowersStatus());

        $response = $this->get('/repositories')->assertOk()
            ->assertSee('3 Repositories')
            ->assertSee('P-22093 sayflowers.ch (SayFlowers Concepts GmbH)')
            ->assertSee('data-repo-row="teamnovu/sayflowers"', false)
            ->assertSee('href="'.url('/projects/teamnovu/sayflowers').'"', false)
            ->assertDontSee('inbudget-sayflowers-jira'); // raw ids only on the detail page
        $this->assertSame(3, substr_count($response->getContent(), 'data-repo-row='));

        preg_match('~data-repo-row="teamnovu/sayflowers".*?</a>~s', $response->getContent(), $row);
        $this->assertStringContainsString('SayFlowers', $row[0]);
        $this->assertMatchesRegularExpression('~data-tracker-chip="jira">Jira <span[^>]*>SAY</span>~', $row[0]);
        $this->assertMatchesRegularExpression('~data-tracker-chip="clickup">ClickUp <span[^>]*>Website</span>~', $row[0]);
        $this->assertStringContainsString('data-tracker-chip="github">GitHub Issues', $row[0]);
        $this->assertStringContainsString('>inBudget<', $row[0]);
        $this->assertStringContainsString('>manuell<', $row[0]);
        $this->assertStringContainsString('aktiv', $row[0]);
        $this->assertStringNotContainsString('fehlt', $row[0]);
        $this->assertNoCollapsibles($response);
    }

    public function test_a_repository_without_tracker_is_a_row_marked_missing(): void
    {
        $this->fakeNyrus($this->sayflowersEntries(), $this->sayflowersStatus());

        $response = $this->get('/projects')->assertOk();
        preg_match('~data-repo-row="teamnovu/intern".*?</a>~s', $response->getContent(), $row);
        $this->assertStringContainsString('P-1000 Intern (novu)', $row[0]);
        $this->assertMatchesRegularExpression('~class="chip text-warning"[^>]*data-tracker-missing[^>]*>Jira/ClickUp fehlt<~', $row[0]);
        $this->assertStringContainsString('nicht eingerichtet', $row[0]);

        $detail = $this->get('/projects/teamnovu/intern')->assertOk()
            ->assertSee('Noch kein Eintrag in nyrus.');
        $jira = $this->trackerSection($detail, 'jira');
        $this->assertStringContainsString('data-connection="disconnected">Nicht verbunden<', $jira);
        $this->assertStringContainsString('data-dialog-open="link-jira"', $jira);
        $this->assertStringContainsString('<input name="teamKeys" value=""', $this->modal($detail, 'link-jira'));
        $this->assertNoCollapsibles($detail);
        $this->assertFormsOnlyInModals($detail);
    }

    public function test_github_issues_alone_make_the_missing_hint_muted(): void
    {
        $status = $this->sayflowersStatus();
        $status['repos'][1]['platforms']['github'] = ['entryId' => 'inbudget-intern-github'];
        $this->fakeNyrus([['id' => 'inbudget-intern-github', 'name' => 'inbudget-intern-github', 'githubUrl' => 'https://github.com/teamnovu/intern', 'linearWorkspaceId' => 'github']], $status);

        $response = $this->get('/projects')->assertOk();
        preg_match('~data-repo-row="teamnovu/intern".*?</a>~s', $response->getContent(), $row);
        $this->assertStringContainsString('data-tracker-chip="github"', $row[0]);
        $this->assertMatchesRegularExpression('~class="chip text-white/45"[^>]*data-tracker-missing~', $row[0]);
    }

    public function test_detail_page_shows_inbudget_value_read_only_and_overridden_manual_value(): void
    {
        $status = $this->sayflowersStatus(
            jira: ['manual' => $this->keys(['OLD'])],
            clickup: ['inbudget' => $this->keys(['90150001']), 'manual' => $this->keys([], ['Website']), 'effective' => $this->keys(['90150001'], ['Website'])],
        );
        $status['trackerLinks'] = ['jira' => 'https://jkweb.atlassian.net/', 'clickup' => 'https://app.clickup.com/14278081'];
        $this->fakeNyrus($this->sayflowersEntries(), $status);

        $response = $this->get('/projects/teamnovu/sayflowers?q=say&page=1')->assertOk()
            ->assertSee('SayFlowers')
            ->assertSee('P-22093 sayflowers.ch (SayFlowers Concepts GmbH)')
            ->assertSee('href="https://github.com/teamnovu/SayFlowers"', false)
            ->assertSee('href="'.url('/repositories?q=say&amp;page=1').'"', false);
        $this->assertNoCollapsibles($response);
        $this->assertFormsOnlyInModals($response);

        // Jira: connected over inBudget (linked), the manual OLD is ignored, changing it needs "Entknüpfen"
        $jira = $this->trackerSection($response, 'jira');
        $this->assertStringContainsString('data-connection="connected"', $jira);
        $this->assertMatchesRegularExpression('~data-source="inbudget">über inBudget<~', $jira);
        $this->assertStringContainsString('<a href="https://jkweb.atlassian.net/browse/SAY" target="_blank" rel="noopener" class="link">SAY</a>', $jira);
        $this->assertMatchesRegularExpression('~data-overridden[^>]*>Ignoriert: <span[^>]*>OLD</span>~', $jira);
        $this->assertStringContainsString('data-dialog-open="detach-jira"', $jira);
        $this->assertStringNotContainsString('data-dialog-open="supplement-jira"', $jira);
        $detach = $this->modal($response, 'detach-jira');
        $this->assertStringContainsString('von inBudget entknüpfen?', $detach);
        $this->assertStringContainsString('Danach gilt dein Wert, auch wenn inBudget einen hat.', $detach);
        $this->assertStringContainsString('<input type="hidden" name="detached" value="1">', $detach);
        $this->assertStringContainsString('<input name="teamKeys" value="OLD"', $detach);

        // ClickUp: Space from inBudget (linked), the List is a manual supplement ("Ergänzen" edits only the List)
        $clickup = $this->trackerSection($response, 'clickup');
        $this->assertStringContainsString('<a href="https://app.clickup.com/14278081/v/s/90150001"', $clickup);
        $this->assertMatchesRegularExpression('~<span class="text-white/80">Liste Website</span>~', $clickup);
        $this->assertStringContainsString('data-dialog-open="supplement-clickup"', $clickup);
        $this->assertStringContainsString('data-dialog-open="detach-clickup"', $clickup);
        $supplement = $this->modal($response, 'supplement-clickup');
        $this->assertStringContainsString('<input name="projectKeys" value="Website"', $supplement);
        $this->assertStringContainsString('<input type="hidden" name="teamKeys" value="">', $supplement);
        $this->assertStringNotContainsString('name="detached"', $supplement);

        // GitHub issues work on their own
        $github = $this->trackerSection($response, 'github');
        $this->assertStringContainsString('data-connection="connected"', $github);
        $this->assertStringContainsString('href="https://github.com/teamnovu/SayFlowers/issues"', $github);

        // settings: read-only summary, the form in a modal; tracker fields and delete only for the manual entry
        $this->assertMatchesRegularExpression('~data-entry="inbudget-sayflowers-jira".*?Branch</span> <span[^>]*>main</span>~s', $response->getContent());
        $managed = $this->modal($response, 'entry-inbudget-sayflowers-jira');
        $this->assertStringContainsString('name="baseBranch"', $managed);
        $this->assertStringContainsString('inbudget-sayflowers-jira', $managed);
        $this->assertStringNotContainsString('Eintrag entfernen', $managed);
        $this->assertStringNotContainsString('name="teamKeys"', $managed);
        $manual = $this->modal($response, 'entry-sayflowers-labels');
        $this->assertStringContainsString('ClickUp-Liste', $manual);
        $this->assertStringContainsString('name="projectKeys" value="Website"', $manual);
        $this->assertStringContainsString('Eintrag entfernen', $manual);
        $this->assertStringNotContainsString('data-dialog-autoopen', $response->getContent());

        // without JavaScript, ?dialog= opens a modal
        $this->get('/projects/teamnovu/sayflowers?dialog=detach-jira')->assertOk()
            ->assertSee('<dialog id="detach-jira" aria-labelledby="detach-jira-title"  open data-dialog-autoopen', false);
    }

    public function test_detached_tracker_shows_the_manual_value_and_can_be_relinked(): void
    {
        $status = $this->sayflowersStatus(jira: ['detached' => true, 'manual' => $this->keys(['NEW']), 'effective' => $this->keys(['NEW'])]);
        $this->fakeNyrus($this->sayflowersEntries(), $status);

        $response = $this->get('/projects/teamnovu/sayflowers')->assertOk();
        $jira = $this->trackerSection($response, 'jira');
        $this->assertMatchesRegularExpression('~data-source="detached">entknüpft \(manuell\)<~', $jira);
        $this->assertStringContainsString('<span class="text-white/80">NEW</span>', $jira); // no trackerLinks: no link
        $this->assertMatchesRegularExpression('~data-inbudget-hint>inBudget: <span[^>]*>SAY</span>~', $jira);
        $this->assertStringContainsString('data-dialog-open="edit-jira"', $jira);
        $this->assertStringContainsString('data-dialog-open="relink-jira"', $jira);
        $this->assertStringNotContainsString('data-dialog-open="detach-jira"', $jira);
        $this->assertStringContainsString('<input type="hidden" name="detached" value="1">', $this->modal($response, 'edit-jira'));
        $this->assertStringContainsString('Danach gilt wieder inBudget', $this->modal($response, 'relink-jira'));
        $this->assertFormsOnlyInModals($response);

        // older nyrus without `detached`/`effective`: effective falls back to inBudget first
        $this->assertSame(['SAY'], ProjectOverview::rows([], $this->sayflowersStatus(jira: ['manual' => $this->keys(['OLD'])]))[0]['trackers']['jira']['summary']);
    }

    public function test_unlink_and_relink_payloads(): void
    {
        $this->fakeNyrus($this->sayflowersEntries(), $this->sayflowersStatus(), ['running' => false]);

        $this->post('/repositories/manual', ['repo' => 'teamnovu/SayFlowers', 'platform' => 'jira', 'detached' => '1', 'teamKeys' => 'NEW', '_detail' => 'teamnovu/sayflowers', '_dialog' => 'detach-jira'])
            ->assertRedirect('/projects/teamnovu/sayflowers')
            ->assertSessionHas('status', 'Von inBudget entknüpft. Dein Wert gilt jetzt.');
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/inbudget/manual')
            && $this->sorted($request->data()) === $this->sorted(['repo' => 'teamnovu/SayFlowers', 'platform' => 'jira', 'detached' => true, 'teamKeys' => ['NEW'], 'projectKeys' => []]));

        $this->post('/repositories/manual', ['repo' => 'teamnovu/SayFlowers', 'platform' => 'jira', 'detached' => '0', 'teamKeys' => '', 'projectKeys' => ''])
            ->assertSessionHas('status', 'Wieder mit inBudget verknüpft.');
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/inbudget/manual')
            && $this->sorted($request->data()) === $this->sorted(['repo' => 'teamnovu/SayFlowers', 'platform' => 'jira', 'detached' => false, 'teamKeys' => [], 'projectKeys' => []]));
    }

    public function test_validation_errors_reopen_the_modal(): void
    {
        $this->fakeNyrus($this->sayflowersEntries(), $this->sayflowersStatus());

        $this->from('/projects/teamnovu/intern')->followingRedirects()
            ->post('/repositories/manual', ['repo' => 'teamnovu/intern', 'platform' => 'jira', 'teamKeys' => str_repeat('X', 1001), '_dialog' => 'link-jira'])
            ->assertOk()
            ->assertSee('<dialog id="link-jira" aria-labelledby="link-jira-title"  open data-dialog-autoopen', false);
    }

    public function test_manual_supplement_is_saved_through_nyrus(): void
    {
        $this->fakeNyrus($this->sayflowersEntries(), $this->sayflowersStatus(), ['running' => false]);

        $this->post('/repositories/manual', [
            'repo' => 'teamnovu/intern',
            'platform' => 'clickup',
            'teamKeys' => ' 90150001 ',
            'projectKeys' => 'Website, Shop ,',
            '_detail' => 'teamnovu/intern',
            '_query' => ['tracker' => 'none', 'evil' => 'x'],
        ])->assertRedirect('/projects/teamnovu/intern?tracker=none')
            ->assertSessionHas('status', 'Gespeichert und mit inBudget abgeglichen.');

        Http::assertSent(fn (Request $request) => $request->method() === 'POST'
            && $request->url() === 'http://nyrus.test/api/dashboard/inbudget/manual'
            && $request->hasHeader('Authorization', 'Bearer secret-key')
            && $this->sorted($request->data()) === $this->sorted(['repo' => 'teamnovu/intern', 'platform' => 'clickup', 'teamKeys' => ['90150001'], 'projectKeys' => ['Website', 'Shop']]));
        $this->assertDatabaseHas('audit_logs', ['action' => 'inbudget.manual', 'subject' => 'teamnovu/intern', 'success' => true]);

        // clearing sends empty lists
        $this->post('/repositories/manual', ['repo' => 'teamnovu/intern', 'platform' => 'jira', 'teamKeys' => '', 'projectKeys' => ''])->assertRedirect('/repositories');
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/inbudget/manual')
            && $this->sorted($request->data()) === $this->sorted(['repo' => 'teamnovu/intern', 'platform' => 'jira', 'teamKeys' => [], 'projectKeys' => []]));
    }

    public function test_manual_supplement_is_validated(): void
    {
        $this->fakeNyrus([], $this->sayflowersStatus());
        $this->post('/repositories/manual', ['repo' => 'not a repo', 'platform' => 'linear'])->assertSessionHasErrors(['repo', 'platform']);
        Http::assertNotSent(fn (Request $request) => str_ends_with($request->url(), '/inbudget/manual'));
    }

    public function test_failed_manual_supplement_shows_the_nyrus_error(): void
    {
        Http::fake(['nyrus.test/api/dashboard/inbudget/manual' => Http::response(['success' => false, 'error' => 'Unknown repository'], 400)]);
        $this->from('/projects/teamnovu/intern')
            ->post('/repositories/manual', ['repo' => 'teamnovu/nope', 'platform' => 'jira', 'teamKeys' => 'X'])
            ->assertRedirect('/projects/teamnovu/intern')
            ->assertSessionHas('error', 'Unknown repository');
        $this->assertDatabaseHas('audit_logs', ['action' => 'inbudget.manual', 'success' => false]);
    }

    public function test_entry_settings_return_to_the_detail_page(): void
    {
        $this->fakeNyrus($this->sayflowersEntries(), $this->sayflowersStatus());

        $this->put('/repositories/inbudget-sayflowers-jira', [
            'baseBranch' => 'develop', 'isActive' => '1', 'routingLabels' => '',
            '_detail' => 'teamnovu/sayflowers', '_query' => ['q' => 'say'],
        ])->assertRedirect('/projects/teamnovu/sayflowers?q=say');

        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/repository/routing')
            && $this->sorted($request->data()) === $this->sorted(['name' => 'inbudget-sayflowers-jira', 'isActive' => true, 'baseBranch' => 'develop', 'routingLabels' => []]));
    }

    public function test_unknown_repository_is_404_and_entries_without_github_have_their_own_page(): void
    {
        $this->fakeNyrus([['id' => 'legacy', 'name' => 'legacy', 'linearWorkspaceId' => 'linear-abc', 'teamKeys' => ['LEG']]]);

        $this->get('/projects/teamnovu/nope')->assertNotFound();
        $this->get('/repositories')->assertOk()->assertSee('href="'.url('/projects/-/legacy').'"', false)->assertSee('linear-abc');
        $this->get('/projects/-/legacy')->assertOk()->assertSee('nicht in inBudget')->assertSee('linear-abc')->assertSee('Team-Keys');
    }

    public function test_filters_including_without_tracker(): void
    {
        $this->fakeNyrus($this->sayflowersEntries(), $this->sayflowersStatus());

        $none = $this->get('/repositories?tracker=none')->assertOk()
            ->assertSee('1 von 3 Repositories')
            ->assertSee('Ohne Jira/ClickUp (1)')
            ->assertSee('data-repo-row="teamnovu/intern"', false)
            ->assertDontSee('data-repo-row="teamnovu/web"', false)
            ->assertSee('href="'.url('/projects/teamnovu/intern?tracker=none').'"', false)
            ->assertSee('Zurücksetzen');
        $this->assertNoCollapsibles($none);

        $this->get('/repositories?tracker=clickup')->assertOk()->assertSee('1 von 3 Repositories')->assertSee('data-repo-row="teamnovu/sayflowers"', false);
        $this->get('/repositories?tracker=jira')->assertOk()->assertSee('2 von 3 Repositories');
        $this->get('/repositories?source=manual')->assertOk()->assertSee('2 von 3 Repositories')->assertDontSee('data-repo-row="teamnovu/intern"', false);
        $this->get('/repositories?source=inbudget')->assertOk()->assertSee('2 von 3 Repositories')->assertDontSee('data-repo-row="teamnovu/web"', false);
        $this->get('/repositories?status=inactive')->assertOk()->assertSee('1 von 3 Repositories')->assertSee('data-repo-row="teamnovu/intern"', false);
        $this->get('/repositories?sort=missing')->assertOk()->assertSeeInOrder(['data-repo-row="teamnovu/intern"', 'data-repo-row="teamnovu/sayflowers"'], false);
    }

    public function test_search_by_name_customer_and_keys(): void
    {
        $this->fakeNyrus($this->sayflowersEntries(), $this->sayflowersStatus());

        $this->get('/repositories?q=concepts+gmbh')->assertOk()->assertSee('1 von 3 Repositories')->assertSee('data-repo-row="teamnovu/sayflowers"', false);
        $this->get('/repositories?q=website')->assertOk()->assertSee('1 von 3 Repositories');
        $this->get('/repositories?q=WEB')->assertOk()->assertSee('2 von 3 Repositories');
    }

    public function test_rows_are_paginated_and_keep_filters(): void
    {
        $this->fakeNyrus(array_map(fn ($i) => [
            'id' => sprintf('repo-%03d', $i), 'name' => sprintf('repo-%03d', $i),
            'githubUrl' => sprintf('https://github.com/teamnovu/repo-%03d', $i), 'linearWorkspaceId' => 'jira-novu', 'teamKeys' => ['X'],
            'isActive' => $i % 5 !== 0,
        ], range(120, 1)));

        $first = $this->get('/repositories')->assertOk()->assertSee('120 Repositories')->assertSee('1–50 angezeigt')
            ->assertSee('data-repo-row="teamnovu/repo-001"', false)->assertDontSee('data-repo-row="teamnovu/repo-051"', false);
        $this->assertSame(50, substr_count($first->getContent(), 'data-repo-row='));

        $last = $this->get('/repositories?page=3&per_page=50')->assertOk()->assertSee('101–120 angezeigt')->assertSee('page=2', false);
        $this->assertSame(20, substr_count($last->getContent(), 'data-repo-row='));

        $this->get('/repositories?sort=-name&per_page=25')->assertOk()->assertSeeInOrder(['teamnovu/repo-120', 'teamnovu/repo-119'], false);

        $active = $this->get('/repositories?status=active&per_page=25')->assertOk()
            ->assertSee('96 von 120 Repositories')
            ->assertSee('status=active&amp;per_page=25&amp;page=2', false)
            ->assertSee('name="_query[status]" value="active"', false);
        $this->assertSame(25, substr_count($active->getContent(), 'data-repo-row='));

        // unknown values fall back to defaults instead of failing
        $this->get('/repositories?per_page=9999&sort=evil&source=x&tracker=y')->assertOk()->assertSee('1–50 angezeigt');
    }

    public function test_fallback_without_repos_from_older_nyrus_groups_config_entries(): void
    {
        $this->fakeNyrus([
            ['id' => 'inbudget-shop-jira', 'name' => 'inbudget-shop-jira', 'githubUrl' => 'https://github.com/teamnovu/shop', 'linearWorkspaceId' => 'jira-novu', 'teamKeys' => ['SHOP']],
            ['id' => 'inbudget-shop-github', 'name' => 'inbudget-shop-github', 'githubUrl' => 'https://github.com/teamnovu/shop', 'linearWorkspaceId' => 'github', 'teamKeys' => ['teamnovu/shop']],
            ['id' => 'tools', 'name' => 'tools', 'githubUrl' => 'https://github.com/teamnovu/tools', 'linearWorkspaceId' => 'github'],
        ], [
            'running' => false,
            'repositories' => [['repo' => 'teamnovu/shop', 'platform' => 'jira', 'workspaceKey' => 'jira-novu', 'teamKeys' => ['SHOP'], 'projects' => ['2041 Webshop']]],
            'unrouted' => ['4000 Intern'],
        ]);

        $response = $this->get('/repositories')->assertOk()->assertSee('2 Repositories')->assertSee('2041 Webshop')
            ->assertDontSee('data-group-header', false)->assertDontSee('Gruppen mit mehreren Repos');
        preg_match('~data-repo-row="teamnovu/shop".*?</a>~s', $response->getContent(), $shop);
        $this->assertMatchesRegularExpression('~data-tracker-chip="jira">Jira <span[^>]*>SHOP</span>~', $shop[0]);
        $this->assertStringContainsString('data-tracker-chip="github"', $shop[0]);
        preg_match('~data-repo-row="teamnovu/tools".*?</a>~s', $response->getContent(), $tools);
        $this->assertStringContainsString('Jira fehlt', $tools[0]);
        $this->assertStringContainsString('Nicht in inBudget', $tools[0]);

        $detail = $this->get('/projects/teamnovu/shop')->assertOk()->assertSee('über inBudget');
        $this->assertStringNotContainsString('Entknüpfen', $detail->getContent());
        $this->assertStringNotContainsString('Ergänzen', $detail->getContent());
        $this->assertStringNotContainsString('data-group', $detail->getContent()); // no grouping UI on older nyrus
        $this->assertFormsOnlyInModals($detail);
        $this->get('/projects/inbudget')->assertOk()->assertSee('4000 Intern')->assertSee('Hinterlege den Link in inBudget.');
    }

    public function test_compact_inbudget_card_links_to_the_report_page(): void
    {
        $status = $this->sayflowersStatus() + [
            'infoCount' => 4200, 'matchedInfoCount' => 900, 'linkCount' => 312, 'resourceRepoCount' => 16,
            'result' => ['added' => ['inbudget-sayflowers-jira'], 'errors' => [['repository' => 'teamnovu/secret', 'message' => 'no access']]],
            'warnings' => [['project' => '5000 Ohne Repo', 'message' => 'has a Jira/ClickUp link but no GitHub repository link']],
            'unrouted' => ['P-1000 Intern (novu)'],
        ];
        $this->fakeNyrus($this->sayflowersEntries(), $status);

        $list = $this->get('/repositories?tracker=none')->assertOk()
            ->assertSee('2 aktive Projekte')
            ->assertSee('1 neu')
            ->assertSee('2 Hinweise zum Abgleich')
            ->assertSee('href="'.url('/projects/inbudget?tracker=none').'"', false)
            ->assertDontSee('teamnovu/secret')
            ->assertDontSee('5000 Ohne Repo');
        $this->assertNoCollapsibles($list);

        $report = $this->get('/projects/inbudget?tracker=none')->assertOk()
            ->assertSee('1 Repository konnte nicht geklont werden')
            ->assertSee('teamnovu/secret')
            ->assertSee('5000 Ohne Repo')
            ->assertSee('P-1000 Intern (novu)')
            ->assertSee('Filter «Ohne Jira/ClickUp»', false)
            ->assertSee('4200 Infos (900 bei aktiven Projekten)')
            ->assertSee('312 erkannte Links')
            ->assertSee('16 Repos aus Kunden-Ressourcen')
            ->assertSee('href="'.url('/repositories?tracker=none').'"', false);
        $this->assertNoCollapsibles($report);

        $this->post('/repositories/inbudget-sync', ['_query' => ['tracker' => 'none']])
            ->assertRedirect('/repositories?tracker=none')
            ->assertSessionHas('status', 'Mit inBudget abgeglichen.');
        $this->assertDatabaseHas('audit_logs', ['action' => 'inbudget.sync', 'success' => true]);
    }

    public function test_inbudget_card_hints_when_no_infos_arrive(): void
    {
        $this->fakeNyrus([], ['running' => false, 'lastSuccessAt' => '2026-11-14T09:30:00.000Z', 'projectCount' => 3, 'repos' => [], 'infoCount' => 0, 'linkCount' => 0]);
        $this->get('/repositories')->assertOk()->assertSee('inBudget hat weder Projekt-Infos noch Repositories von Kunden-Ressourcen geliefert – sieht der Token-User sie?');
    }

    public function test_without_inbudget_the_card_is_hidden(): void
    {
        $this->fakeNyrus([]);
        $this->get('/repositories')->assertOk()->assertDontSee('Jetzt abgleichen')->assertSee('Noch keine Repositories.');
        $this->get('/projects/inbudget')->assertOk()->assertSee('keine inBudget-Anbindung');
    }

    public function test_menu_and_heading_say_projekte(): void
    {
        $this->fakeNyrus($this->sayflowersEntries(), $this->sayflowersStatus());

        $this->get('/repositories')->assertOk()
            ->assertSee('<title>Projekte · nyrus</title>', false)
            ->assertSeeInOrder(['Übersicht', 'Projekte', 'Einstellungen']);
        $this->get('/projects/teamnovu/sayflowers')->assertOk()->assertSee('aria-current="page"', false);
    }

    public function test_add_dialog_and_adding_a_repository(): void
    {
        $this->fakeNyrus([['id' => 'web', 'name' => 'web', 'linearWorkspaceId' => 'jira-novu']]);

        $this->get('/repositories')->assertOk()
            ->assertSee('<dialog id="add-repository"', false)
            ->assertSee('<option value="jira-novu">', false)
            ->assertSee('<option value="github">', false)
            ->assertDontSee('data-dialog-autoopen', false);

        // without JavaScript, ?add=1 shows the dialog; a detail page can prefill the URL
        $this->get('/repositories?add=1&repository_url=https://github.com/teamnovu/intern')->assertOk()
            ->assertSee('data-dialog-autoopen', false)
            ->assertSee('value="https://github.com/teamnovu/intern"', false);

        $this->from('/repositories?q=we')
            ->followingRedirects()
            ->post('/repositories', ['_form' => 'add', 'repository_url' => 'file:///etc/passwd', 'name' => 'mein-repo'])
            ->assertOk()
            ->assertSee('data-dialog-autoopen', false)
            ->assertSee('value="file:///etc/passwd"', false)
            ->assertSee('value="mein-repo"', false);

        $this->post('/repositories', [
            'repository_url' => 'https://github.com/teamnovu/api.git',
            'baseBranch' => 'develop',
            'teamKeys' => 'API, Backend ,',
            'linearWorkspaceId' => 'jira-novu',
            '_query' => ['q' => 'api'],
        ])->assertRedirect('/repositories?q=api');
        Http::assertSent(fn (Request $request) => $request->url() === 'http://nyrus.test/api/dashboard/repository'
            && $request->method() === 'POST'
            && $request['linearWorkspaceId'] === 'jira-novu'
            && $request['teamKeys'] === ['API', 'Backend']);

        $this->post('/repositories', ['repository_url' => 'git@github.com:teamnovu/Web.git', 'linearWorkspaceId' => 'github'])->assertRedirect('/repositories');
        Http::assertSent(fn (Request $request) => $request->url() === 'http://nyrus.test/api/dashboard/repository'
            && $request['linearWorkspaceId'] === 'github'
            && $request['teamKeys'] === ['teamnovu/web']);
    }

    public function test_saving_returns_to_the_filtered_list(): void
    {
        $this->fakeNyrus([]);

        $this->put('/repositories/web', ['baseBranch' => 'main', '_query' => ['q' => 'web', 'page' => '2', 'evil' => 'x']])
            ->assertRedirect('/repositories?q=web&page=2');
    }

    /**
     * Grouped: Zuriga AG (customer, 2 repos), SayFlowers (customer, alone),
     * "Shop" (manual: teamnovu/intern from inBudget + the hand-added teamnovu/web).
     */
    private function groupedStatus(): array
    {
        $group = fn (string $key, string $name, string $source, ?string $customer) => compact('key', 'name', 'source', 'customer');
        $empty = ['inbudget' => $this->keys(), 'manual' => $this->keys(), 'effective' => $this->keys()];
        $repo = fn (string $repo, string $project, array $group) => ['repo' => $repo, 'projects' => [$project], 'platforms' => ['jira' => $empty], 'group' => $group];

        return [
            'running' => false,
            'trackers' => ['jira' => true, 'clickup' => false, 'github' => true],
            'repos' => [
                $repo('teamnovu/zuriga-web', 'P-10 Website (Zuriga AG)', $group('client:10', 'Zuriga AG', 'inbudget', 'Zuriga AG')),
                $repo('teamnovu/zuriga-cms', 'P-11 CMS (Zuriga AG)', $group('client:10', 'Zuriga AG', 'inbudget', 'Zuriga AG')),
                $repo('teamnovu/SayFlowers', 'P-22093 sayflowers.ch', $group('client:22', 'SayFlowers Concepts GmbH', 'inbudget', 'SayFlowers Concepts GmbH')),
                $repo('teamnovu/intern', 'P-1000 Intern', $group('manual:shop', 'Shop', 'manual', 'novu ag')),
            ],
            'groups' => [
                ['key' => 'client:10', 'name' => 'Zuriga AG', 'source' => 'inbudget', 'repos' => ['teamnovu/zuriga-web', 'teamnovu/zuriga-cms']],
                ['key' => 'client:22', 'name' => 'SayFlowers Concepts GmbH', 'source' => 'inbudget', 'repos' => ['teamnovu/SayFlowers']],
                ['key' => 'manual:shop', 'name' => 'Shop', 'source' => 'manual', 'repos' => ['teamnovu/intern', 'teamnovu/web']],
            ],
        ];
    }

    private function groupedEntries(): array
    {
        return [
            ['id' => 'web', 'name' => 'web', 'githubUrl' => 'https://github.com/teamnovu/web', 'linearWorkspaceId' => 'jira-novu', 'teamKeys' => ['WEB'], 'routingGroup' => 'shop'],
            ['id' => 'tools', 'name' => 'tools', 'githubUrl' => 'https://github.com/teamnovu/tools', 'linearWorkspaceId' => 'github'],
        ];
    }

    /** A group change for one repository may be part of a request for several (`repos`). */
    private function assertManualSent(array $payload): void
    {
        Http::assertSent(function (Request $request) use ($payload) {
            if (! str_ends_with($request->url(), '/inbudget/manual')) {
                return false;
            }
            $data = $request->data();
            if (isset($data['repos'], $payload['repo']) && array_key_exists('group', $payload)) {
                return in_array($payload['repo'], $data['repos'], true)
                    && array_key_exists('group', $data) && $data['group'] === $payload['group']
                    && count($data) === 2;
            }

            return $this->sorted($data) === $this->sorted($payload);
        });
    }

    private function assertRoutingSent(array $payload): void
    {
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/repository/routing')
            && $this->sorted($request->data()) === $this->sorted($payload));
    }

    public function test_list_groups_repositories_and_single_repo_groups_have_no_header(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupedStatus());

        $response = $this->get('/projects')->assertOk()->assertSee('6 Repositories');
        $html = $response->getContent();
        $this->assertSame(2, substr_count($html, 'data-group-header='));
        $this->assertSame(6, substr_count($html, 'data-repo-row='));
        $response->assertSeeInOrder([
            'data-group-header="manual:shop"', 'data-repo-row="teamnovu/intern"', 'data-repo-row="teamnovu/web"',
            'data-repo-row="teamnovu/sayflowers"', 'data-repo-row="teamnovu/tools"',
            'data-group-header="client:10"', 'data-repo-row="teamnovu/zuriga-cms"', 'data-repo-row="teamnovu/zuriga-web"',
        ], false);

        preg_match('~data-group-header="client:10".*?</div>~s', $html, $zuriga);
        $this->assertStringContainsString('>Zuriga AG<', $zuriga[0]);
        $this->assertMatchesRegularExpression('~data-group-source="inbudget"[^>]*>Kunde<~', $zuriga[0]);
        $this->assertStringContainsString('2 Repos', $zuriga[0]);
        $this->assertStringContainsString('href="'.url('/projects/groups/client:10').'"', $zuriga[0]);
        $this->assertStringContainsString('Gruppe bearbeiten', $zuriga[0]);
        preg_match('~data-group-header="manual:shop".*?</div>~s', $html, $shop);
        $this->assertMatchesRegularExpression('~data-group-source="manual"[^>]*>manuell<~', $shop[0]);
        $this->assertNoCollapsibles($response);

        // filter, sort and search
        $multi = $this->get('/projects?group=multi')->assertOk()->assertSee('4 von 6 Repositories')->assertSee('Gruppen mit mehreren Repos (4)');
        $this->assertStringNotContainsString('data-repo-row="teamnovu/tools"', $multi->getContent());
        $this->get('/projects?group=single')->assertOk()->assertSee('2 von 6 Repositories');
        $this->get('/projects?sort=group')->assertOk()->assertSeeInOrder(['data-group-header="manual:shop"', 'data-group-header="client:10"', 'data-repo-row="teamnovu/sayflowers"'], false);
        $this->get('/projects?q=zuriga+ag')->assertOk()->assertSee('2 von 6 Repositories')->assertSee('data-group-header="client:10"', false);
        $partial = $this->get('/projects?q=cms')->assertOk()->assertSee('1 von 6 Repositories');
        $this->assertMatchesRegularExpression('~data-group-header="client:10".*?2 Repos · 1 passen~s', $partial->getContent());
    }

    public function test_groups_are_paginated_as_a_whole(): void
    {
        // 30 customers with 2 repositories each
        $repos = [];
        foreach (range(1, 60) as $i) {
            $client = intdiv($i + 1, 2);
            $repos[] = ['repo' => sprintf('teamnovu/repo-%03d', $i), 'projects' => [], 'platforms' => [],
                'group' => ['key' => "client:{$client}", 'name' => sprintf('Kunde %02d', $client), 'source' => 'inbudget', 'customer' => sprintf('Kunde %02d', $client)]];
        }
        $this->fakeNyrus([], ['running' => false, 'repos' => $repos]);

        $first = $this->get('/projects?per_page=25')->assertOk()->assertSee('60 Repositories')->assertSee('1–50 angezeigt');
        $this->assertSame(25, substr_count($first->getContent(), 'data-group-header='));
        $this->assertSame(50, substr_count($first->getContent(), 'data-repo-row='));
        $last = $this->get('/projects?per_page=25&page=2')->assertOk()->assertSee('51–60 angezeigt');
        $this->assertSame(5, substr_count($last->getContent(), 'data-group-header='));
    }

    public function test_detail_page_shows_the_group_and_the_change_modal(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupedStatus());

        $response = $this->get('/projects/teamnovu/zuriga-web')->assertOk();
        $this->assertFormsOnlyInModals($response);
        $this->assertNoCollapsibles($response);
        preg_match('~data-group-section="client:10".*?</section>|data-group-section="client:10".*?Gruppe öffnen~s', $response->getContent(), $section);
        $this->assertStringContainsString('Zuriga AG', $section[0]);
        $this->assertStringContainsString('href="'.url('/projects/teamnovu/zuriga-cms').'"', $section[0]);
        $this->assertStringContainsString('data-dialog-open="group-change"', $section[0]);
        $response->assertSee('data-header-group', false);

        $modal = $this->modal($response, 'group-change');
        $this->assertStringContainsString('Tickets für ein Repo dieser Gruppe bekommen alle Repos der Gruppe.', $modal);
        $this->assertStringContainsString('<option value="manual:shop" >Shop (2 Repos, manuell)</option>', $modal);
        $this->assertStringContainsString('<option value="client:22" >SayFlowers Concepts GmbH (1 Repo)</option>', $modal);
        $this->assertStringNotContainsString('value="client:10"', $modal);
        $this->assertStringContainsString('value="alone"', $modal);
        $this->assertStringNotContainsString('Zurück zum Kunden', $modal); // already the customer group

        $intern = $this->modal($this->get('/projects/teamnovu/intern')->assertOk(), 'group-change');
        $this->assertStringContainsString('Zurück zum Kunden (novu ag)', $intern);

        // the hand-added repository has no customer
        $web = $this->get('/projects/teamnovu/web')->assertOk()->assertSee('data-group-section="manual:shop"', false);
        $this->assertStringNotContainsString('Zurück zum Kunden', $this->modal($web, 'group-change'));
        $tools = $this->get('/projects/teamnovu/tools')->assertOk()->assertSee('Keine weiteren Repos.');
        $this->assertStringContainsString('data-group-source="alone"', $tools->getContent());
    }

    public function test_changing_the_group_of_a_repository_sends_name_empty_or_null(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupedStatus());

        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/zuriga-cms', 'mode' => 'new', 'name' => ' Zuriga ', '_detail' => 'teamnovu/zuriga-cms', '_query' => ['q' => 'zu']])
            ->assertRedirect('/projects/teamnovu/zuriga-cms?q=zu')
            ->assertSessionHas('status');
        $this->assertManualSent(['repo' => 'teamnovu/zuriga-cms', 'group' => 'Zuriga']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'repository.group', 'subject' => 'teamnovu/zuriga-cms', 'success' => true]);

        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/zuriga-cms', 'mode' => 'alone']);
        $this->assertManualSent(['repo' => 'teamnovu/zuriga-cms', 'group' => '']);

        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/intern', 'mode' => 'customer']);
        $this->assertManualSent(['repo' => 'teamnovu/intern', 'group' => null]);

        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/zuriga-web', 'mode' => 'existing', 'target' => 'manual:shop']);
        $this->assertManualSent(['repo' => 'teamnovu/zuriga-web', 'group' => 'Shop']);

        // joining another customer's group makes it a manual group of that name with all members
        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/SayFlowers', 'mode' => 'existing', 'target' => 'client:10']);
        foreach (['teamnovu/zuriga-web', 'teamnovu/zuriga-cms', 'teamnovu/SayFlowers'] as $repo) {
            $this->assertManualSent(['repo' => $repo, 'group' => 'Zuriga AG']);
        }

        // a hand-added repository: routingGroup on its config entry
        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/tools', 'mode' => 'new', 'name' => 'Shop']);
        $this->assertRoutingSent(['name' => 'tools', 'routingGroup' => 'Shop']);
        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/web', 'mode' => 'alone']);
        $this->assertRoutingSent(['name' => 'web', 'routingGroup' => '']);
        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/web', 'mode' => 'customer'])
            ->assertSessionHas('error', 'Dieses Repository gehört zu keinem inBudget-Kunden.');
    }

    public function test_group_changes_are_validated(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupedStatus());

        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/tools', 'mode' => 'new', 'name' => ''])->assertSessionHasErrors('name');
        $this->post('/projects/groups', ['action' => 'evil'])->assertSessionHasErrors('action');
        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'not a repo', 'mode' => 'alone'])->assertSessionHasErrors('repo');
        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/nope', 'mode' => 'alone'])->assertSessionHas('error');
        Http::assertNotSent(fn (Request $request) => str_ends_with($request->url(), '/inbudget/manual') || str_ends_with($request->url(), '/repository/routing'));
    }

    public function test_group_page_lists_members_and_its_actions(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupedStatus());

        $page = $this->get('/projects/groups/client:10')->assertOk()
            ->assertSee('Zuriga AG')
            ->assertSee('data-member="teamnovu/zuriga-web"', false)
            ->assertSee('data-member="teamnovu/zuriga-cms"', false)
            ->assertSee('Als eigene Gruppe benennen')
            ->assertSee('Auflösen')
            ->assertDontSee('Zurück zu den Kunden');
        $this->assertNoCollapsibles($page);
        $add = $this->modal($page, 'group-add');
        $this->assertStringContainsString('<option value="teamnovu/intern">teamnovu/intern – Shop</option>', $add);
        $this->assertStringNotContainsString('value="teamnovu/zuriga-web"', $add);
        $this->assertStringContainsString('Macht daraus eine manuelle Gruppe mit allen 2 Repos.', $this->modal($page, 'group-rename'));

        $this->get('/projects/groups/manual:shop')->assertOk()->assertSee('Umbenennen')->assertSee('Zurück zu den Kunden')->assertSee('data-member="teamnovu/web"', false);
        $this->get('/projects/groups/manual:nope')->assertNotFound();
    }

    public function test_group_page_rename_dissolve_add_remove_and_back_to_customer(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupedStatus());

        // renaming a customer group: a manual group with all its members
        $this->post('/projects/groups', ['action' => 'rename', 'group' => 'client:10', 'name' => 'Zuriga'])
            ->assertRedirect('/projects/groups/manual:zuriga');
        $this->assertManualSent(['repo' => 'teamnovu/zuriga-web', 'group' => 'Zuriga']);
        $this->assertManualSent(['repo' => 'teamnovu/zuriga-cms', 'group' => 'Zuriga']);
        // one request for the whole group
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/inbudget/manual')
            && ($request->data()['repos'] ?? null) !== null && count($request->data()['repos']) === 2);

        // renaming a manual group: inBudget repos and hand-added entries
        $this->post('/projects/groups', ['action' => 'rename', 'group' => 'manual:shop', 'name' => 'Webshop']);
        $this->assertManualSent(['repo' => 'teamnovu/intern', 'group' => 'Webshop']);
        $this->assertRoutingSent(['name' => 'web', 'routingGroup' => 'Webshop']);

        $this->post('/projects/groups', ['action' => 'dissolve', 'group' => 'client:10'])->assertRedirect('/repositories');
        $this->assertManualSent(['repo' => 'teamnovu/zuriga-web', 'group' => '']);
        $this->assertManualSent(['repo' => 'teamnovu/zuriga-cms', 'group' => '']);

        $this->post('/projects/groups', ['action' => 'customer', 'group' => 'manual:shop']);
        $this->assertManualSent(['repo' => 'teamnovu/intern', 'group' => null]);
        $this->assertRoutingSent(['name' => 'web', 'routingGroup' => '']);

        $this->post('/projects/groups', ['action' => 'add', 'group' => 'manual:shop', 'repo' => 'teamnovu/tools'])
            ->assertRedirect('/projects/groups/manual:shop');
        $this->assertRoutingSent(['name' => 'tools', 'routingGroup' => 'Shop']);

        $this->post('/projects/groups', ['action' => 'remove', 'group' => 'client:10', 'repo' => 'teamnovu/zuriga-cms'])->assertRedirect('/repositories');
        $this->assertManualSent(['repo' => 'teamnovu/zuriga-cms', 'group' => '']);
    }

    public function test_failed_group_change_shows_the_nyrus_error(): void
    {
        Http::fake([
            'nyrus.test/api/dashboard/config' => Http::response(['success' => true, 'data' => ['repositories' => $this->groupedEntries(), 'settingKeys' => []]]),
            'nyrus.test/api/dashboard/inbudget/manual' => Http::response(['success' => false, 'error' => 'Unknown repository'], 400),
            'nyrus.test/api/dashboard/inbudget' => Http::response(['success' => true, 'data' => ['status' => $this->groupedStatus()]]),
        ]);
        $this->post('/projects/groups', ['action' => 'move', 'repo' => 'teamnovu/intern', 'mode' => 'alone', '_detail' => 'teamnovu/intern'])
            ->assertRedirect('/projects/teamnovu/intern')
            ->assertSessionHas('error', 'Gruppe nicht (ganz) gespeichert: teamnovu/intern: Unknown repository');
        $this->assertDatabaseHas('audit_logs', ['action' => 'repository.group', 'success' => false]);
    }

    /**
     * groupedStatus() of a nyrus with Jira/ClickUp on group level: Zuriga AG has
     * its own Jira ZUR, zuriga-web brings ZURS from inBudget, zuriga-cms has
     * nothing itself; the manual group Shop gets WEB from the hand-added web.
     */
    private function groupTrackerStatus(): array
    {
        $status = $this->groupedStatus();
        $status['trackers']['clickup'] = true;
        $status['trackerLinks'] = ['jira' => 'https://jkweb.atlassian.net/', 'clickup' => 'https://app.clickup.com/14278081'];
        $empty = ['own' => $this->keys(), 'effective' => $this->keys()];
        $platforms = [
            'client:10' => ['jira' => ['own' => $this->keys(['ZUR']), 'effective' => $this->keys(['ZUR', 'ZURS'])], 'clickup' => $empty],
            'client:22' => ['jira' => $empty, 'clickup' => $empty],
            'manual:shop' => ['jira' => ['own' => $this->keys(), 'effective' => $this->keys(['WEB'])], 'clickup' => $empty],
        ];
        foreach ($status['groups'] as &$group) {
            $group['platforms'] = $platforms[$group['key']];
        }
        unset($group);

        $jira = fn (array $inbudget, array $inherited) => ['inbudget' => $this->keys($inbudget), 'manual' => $this->keys(), 'effective' => $this->keys($inbudget),
            'inherited' => $this->keys($inherited), 'entryId' => 'inbudget-x-jira'];
        $status['repos'][0]['platforms']['jira'] = $jira(['ZURS'], ['ZUR']);   // zuriga-web
        $status['repos'][1]['platforms']['jira'] = $jira([], ['ZUR', 'ZURS']); // zuriga-cms
        $status['repos'][3]['platforms']['jira'] = $jira([], ['WEB']);         // intern (Shop)

        return $status;
    }

    public function test_group_page_shows_the_group_trackers_and_where_keys_come_from(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupTrackerStatus());

        $page = $this->get('/projects/groups/client:10')->assertOk()->assertSee('Verbindungen');
        $this->assertNoCollapsibles($page);
        $this->assertFormsOnlyInModals($page);
        $html = $page->getContent();

        preg_match('~data-group-tracker="jira".*?</section>~s', $html, $jira);
        $this->assertStringContainsString('data-connection="connected">', $jira[0]);
        $this->assertMatchesRegularExpression('~data-key="ZUR">\s*<a href="https://jkweb.atlassian.net/browse/ZUR"[^>]*>ZUR</a>\s*<span[^>]*data-key-source="group">für die Gruppe</span>~', $jira[0]);
        $this->assertMatchesRegularExpression('~data-key="ZURS">\s*<a href="https://jkweb.atlassian.net/browse/ZURS"[^>]*>ZURS</a>\s*<span[^>]*data-key-source="inbudget">aus inBudget <a class="link" href="'.preg_quote(url('/projects/teamnovu/zuriga-web'), '~').'">zuriga-web</a>~', $jira[0]);
        $this->assertStringContainsString('data-dialog-open="group-edit-jira"', $jira[0]);
        $this->assertStringContainsString('data-dialog-open="group-clear-jira"', $jira[0]);
        $this->assertStringNotContainsString('data-dialog-open="group-link-jira"', $jira[0]);

        $edit = $this->modal($page, 'group-edit-jira');
        $this->assertStringContainsString('Gilt für alle Repos der Gruppe.', $edit);
        $this->assertStringContainsString('<input type="hidden" name="group" value="client:10">', $edit);
        $this->assertStringContainsString('<input name="teamKeys" value="ZUR"', $edit);
        $this->assertStringNotContainsString('name="projectKeys"', $edit);
        $clear = $this->modal($page, 'group-clear-jira');
        $this->assertStringContainsString('<input type="hidden" name="teamKeys" value="">', $clear);
        $this->assertStringContainsString('<input type="hidden" name="projectKeys" value="">', $clear);

        // ClickUp: nothing on the group nor its members
        preg_match('~data-group-tracker="clickup".*?</section>~s', $html, $clickup);
        $this->assertStringContainsString('data-connection="disconnected">Nicht verbunden<', $clickup[0]);
        $this->assertMatchesRegularExpression('~data-dialog-open="group-link-clickup" class="btn"~', $clickup[0]);
        $link = $this->modal($page, 'group-link-clickup');
        $this->assertStringContainsString('<input name="teamKeys" value=""', $link);
        $this->assertStringContainsString('<input name="projectKeys" value=""', $link);

        // the members' remove buttons open a modal too
        $this->assertStringContainsString('name="action" value="remove"', $this->modal($page, 'remove-teamnovuzuriga-cms'));

        // Shop: connected only through a member set by hand
        $shop = $this->get('/projects/groups/manual:shop')->assertOk();
        preg_match('~data-group-tracker="jira".*?</section>~s', $shop->getContent(), $shopJira);
        $this->assertStringContainsString('data-connection="connected">', $shopJira[0]);
        $this->assertMatchesRegularExpression('~data-key-source="manual">von <a class="link" href="'.preg_quote(url('/projects/teamnovu/web'), '~').'">web</a>~', $shopJira[0]);
        $this->assertStringNotContainsString('data-key-source="group"', $shopJira[0]);
        $this->assertMatchesRegularExpression('~data-dialog-open="group-link-jira" class="btn-ghost"~', $shopJira[0]);
        $this->assertFormsOnlyInModals($shop);
    }

    public function test_group_trackers_are_saved_with_the_group_key_and_cleared_with_empty_lists(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupTrackerStatus());

        $this->post('/projects/groups/trackers', ['group' => 'client:10', 'platform' => 'clickup', 'teamKeys' => ' 9015 ', 'projectKeys' => 'Website, Shop,', '_query' => ['q' => 'zu']])
            ->assertRedirect('/projects/groups/client:10?q=zu')
            ->assertSessionHas('status', 'Gespeichert. Gilt für alle Repos der Gruppe.');
        $this->assertManualSent(['groupKey' => 'client:10', 'platform' => 'clickup', 'teamKeys' => ['9015'], 'projectKeys' => ['Website', 'Shop']]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'group.trackers', 'subject' => 'client:10', 'success' => true]);

        // Jira has no lists
        $this->post('/projects/groups/trackers', ['group' => 'manual:shop', 'platform' => 'jira', 'teamKeys' => 'WEB, SHOP', 'projectKeys' => 'x']);
        $this->assertManualSent(['groupKey' => 'manual:shop', 'platform' => 'jira', 'teamKeys' => ['WEB', 'SHOP'], 'projectKeys' => []]);

        // "Entfernen": empty lists
        $this->post('/projects/groups/trackers', ['group' => 'client:10', 'platform' => 'jira', 'teamKeys' => '', 'projectKeys' => ''])
            ->assertRedirect('/projects/groups/client:10')
            ->assertSessionHas('status', 'Jira der Gruppe entfernt.');
        $this->assertManualSent(['groupKey' => 'client:10', 'platform' => 'jira', 'teamKeys' => [], 'projectKeys' => []]);
    }

    public function test_group_trackers_are_validated(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupTrackerStatus());

        $this->post('/projects/groups/trackers', ['group' => 'client:10', 'platform' => 'github', 'teamKeys' => 'x'])->assertSessionHasErrors('platform');
        $this->post('/projects/groups/trackers', ['platform' => 'jira'])->assertSessionHasErrors('group');
        $this->post('/projects/groups/trackers', ['group' => 'client:99', 'platform' => 'jira', 'teamKeys' => 'X'])->assertSessionHas('error');
        Http::assertNotSent(fn (Request $request) => str_ends_with($request->url(), '/inbudget/manual'));
    }

    public function test_list_shows_group_trackers_in_the_header_and_inherited_ones_muted(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupTrackerStatus());

        $html = $this->get('/projects')->assertOk()->getContent();
        preg_match('~data-group-header="client:10".*?</div>~s', $html, $zuriga);
        $this->assertMatchesRegularExpression('~data-group-tracker-chip="jira"[^>]*>Jira <span[^>]*>ZUR, ZURS</span>~', $zuriga[0]);
        preg_match('~data-group-header="manual:shop".*?</div>~s', $html, $shop);
        $this->assertMatchesRegularExpression('~data-group-tracker-chip="jira"[^>]*>Jira <span[^>]*>WEB</span>~', $shop[0]);
        $this->assertStringNotContainsString('data-group-tracker-chip="clickup"', $html);

        // zuriga-cms only inherits: a muted chip without keys, not "fehlt"
        preg_match('~data-repo-row="teamnovu/zuriga-cms".*?</a>~s', $html, $cms);
        $this->assertMatchesRegularExpression('~class="chip text-white/40" data-tracker-chip="jira" data-inherited[^>]*>Jira</span>~', $cms[0]);
        $this->assertStringNotContainsString('data-tracker-missing', $cms[0]);
        // zuriga-web shows its own key
        preg_match('~data-repo-row="teamnovu/zuriga-web".*?</a>~s', $html, $web);
        $this->assertMatchesRegularExpression('~data-tracker-chip="jira">Jira <span[^>]*>ZURS</span>~', $web[0]);

        // filters count inherited trackers as connected
        $this->get('/projects?tracker=jira')->assertOk()->assertSee('data-repo-row="teamnovu/zuriga-cms"', false);
    }

    public function test_repository_page_shows_inherited_keys_with_the_group(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupTrackerStatus());

        $page = $this->get('/projects/teamnovu/zuriga-cms')->assertOk();
        $this->assertFormsOnlyInModals($page);
        $this->assertNoCollapsibles($page);
        $jira = $this->trackerSection($page, 'jira');
        $this->assertStringContainsString('data-connection="connected">', $jira);
        $this->assertStringContainsString('data-source="inherited">geerbt<', $jira);
        $this->assertMatchesRegularExpression('~von Gruppe\s*<a href="'.preg_quote(url('/projects/groups/client:10'), '~').'" class="link" data-inherited-group>Zuriga AG</a>~', $jira);
        $this->assertStringContainsString('<a href="https://jkweb.atlassian.net/browse/ZUR" target="_blank" rel="noopener" class="link">ZUR</a>', $jira);
        $this->assertStringContainsString('<a href="https://jkweb.atlassian.net/browse/ZURS" target="_blank" rel="noopener" class="link">ZURS</a>', $jira);
        $this->assertStringNotContainsString('data-source="inbudget"', $jira);
        // repo-level actions stay, plus the way to the group
        $this->assertMatchesRegularExpression('~data-dialog-open="link-jira" class="btn-ghost"~', $jira);
        $this->assertMatchesRegularExpression('~data-group-level-link>Auf Gruppenebene bearbeiten<~', $jira);

        // zuriga-web: its own ZURS from inBudget, ZUR inherited
        $web = $this->trackerSection($this->get('/projects/teamnovu/zuriga-web')->assertOk(), 'jira');
        $this->assertStringContainsString('data-source="inbudget">über inBudget<', $web);
        $this->assertMatchesRegularExpression('~data-links>.*>ZURS</a>.*data-inherited-links>.*>ZUR</a>~s', $web);
    }

    public function test_without_group_trackers_from_older_nyrus_there_is_no_group_level_ui(): void
    {
        $this->fakeNyrus($this->groupedEntries(), $this->groupedStatus());

        $group = $this->get('/projects/groups/client:10')->assertOk()->assertDontSee('data-group-tracker=', false)->assertDontSee('Verbindungen');
        $this->assertFormsOnlyInModals($group);
        $this->get('/projects')->assertOk()->assertDontSee('data-group-tracker-chip', false);
        $this->get('/projects/teamnovu/zuriga-cms')->assertOk()->assertDontSee('data-group-level-link', false)->assertDontSee('data-inherited', false);

        $this->post('/projects/groups/trackers', ['group' => 'client:10', 'platform' => 'jira', 'teamKeys' => 'ZUR'])
            ->assertSessionHas('error', 'Diese nyrus-Version kennt noch keine Tracker auf Gruppenebene.');
        Http::assertNotSent(fn (Request $request) => str_ends_with($request->url(), '/inbudget/manual'));
    }

    public function test_shows_full_and_last_fetch_of_the_inbudget_sync(): void
    {
        $this->fakeNyrus([], ['running' => false, 'lastSuccessAt' => '2026-11-14T10:00:00Z', 'lastFullSyncAt' => '2026-11-14T03:00:00Z',
            'lastFetch' => ['mode' => 'changes', 'requests' => 5], 'projectCount' => 1, 'repositories' => [], 'repos' => []]);
        $this->get('/projects/inbudget')->assertOk()
            ->assertSee('Vollständig:')
            ->assertSee('Letzter Abruf: nur Änderungen, 5 Anfragen');
    }
}
