<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\NyrusClient;
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
            ->assertSee('nyrus hat noch keinen Eintrag für dieses Repository.');
        $this->assertStringContainsString('fehlt', $this->trackerSection($detail, 'jira'));
        $this->assertStringContainsString('name="teamKeys"', $this->trackerSection($detail, 'jira'));
        $this->assertNoCollapsibles($detail);
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
        $this->fakeNyrus($this->sayflowersEntries(), $status);

        $response = $this->get('/projects/teamnovu/sayflowers?q=say&page=1')->assertOk()
            ->assertSee('SayFlowers')
            ->assertSee('P-22093 sayflowers.ch (SayFlowers Concepts GmbH)')
            ->assertSee('href="'.url('/repositories?q=say&amp;page=1').'"', false);
        $this->assertNoCollapsibles($response);

        // Jira: inBudget has SAY, so the manual OLD is shown as overridden and can't be edited
        $jira = $this->trackerSection($response, 'jira');
        $this->assertMatchesRegularExpression('~data-inbudget-value>\s*<span[^>]*>SAY</span>\s*<span[^>]*>aus inBudget</span>~', $jira);
        $this->assertStringContainsString('überschrieben durch inBudget', $jira);
        $this->assertStringContainsString('<input type="hidden" name="teamKeys" value="OLD">', $jira);
        $this->assertDoesNotMatchRegularExpression('~<input name="teamKeys"~', $jira);
        $this->assertStringNotContainsString('Ergänzung speichern', $jira);

        // ClickUp: the Space comes from inBudget, the List is a manual supplement and stays editable
        $clickup = $this->trackerSection($response, 'clickup');
        $this->assertMatchesRegularExpression('~data-inbudget-value>\s*<span[^>]*>90150001</span>~', $clickup);
        $this->assertStringContainsString('<input name="projectKeys" value="Website"', $clickup);
        $this->assertStringContainsString('In inBudget nicht hinterlegt.', $clickup);
        $this->assertStringContainsString('Ergänzung speichern', $clickup);

        // GitHub issues work on their own
        $this->assertStringContainsString('verknüpft', $this->trackerSection($response, 'github'));

        // entries: settings for all, tracker fields and delete only for the manual one
        preg_match('~data-entry="inbudget-sayflowers-jira".*?(?=data-entry=|$)~s', $response->getContent(), $managed);
        $this->assertStringContainsString('name="baseBranch"', $managed[0]);
        $this->assertStringNotContainsString('Eintrag entfernen', $managed[0]);
        $this->assertStringNotContainsString('name="teamKeys"', $managed[0]);
        preg_match('~data-entry="sayflowers-labels".*?(?=data-entry=|$)~s', $response->getContent(), $manual);
        $this->assertStringContainsString('ClickUp-Liste', $manual[0]);
        $this->assertStringContainsString('name="projectKeys" value="Website"', $manual[0]);
        $this->assertStringContainsString('Eintrag entfernen', $manual[0]);
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
        $this->get('/projects/-/legacy')->assertOk()->assertSee('Nicht in inBudget, hier manuell angelegt.')->assertSee('Team-Keys');
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

        $response = $this->get('/repositories')->assertOk()->assertSee('2 Repositories')->assertSee('2041 Webshop');
        preg_match('~data-repo-row="teamnovu/shop".*?</a>~s', $response->getContent(), $shop);
        $this->assertMatchesRegularExpression('~data-tracker-chip="jira">Jira <span[^>]*>SHOP</span>~', $shop[0]);
        $this->assertStringContainsString('data-tracker-chip="github"', $shop[0]);
        preg_match('~data-repo-row="teamnovu/tools".*?</a>~s', $response->getContent(), $tools);
        $this->assertStringContainsString('Jira fehlt', $tools[0]);
        $this->assertStringContainsString('Nicht in inBudget', $tools[0]);

        $detail = $this->get('/projects/teamnovu/shop')->assertOk()->assertSee('Aus inBudget:');
        $this->assertStringNotContainsString('Ergänzung speichern', $detail->getContent());
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
}
