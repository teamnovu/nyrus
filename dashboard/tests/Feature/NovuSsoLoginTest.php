<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\NovuSso;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class NovuSsoLoginTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.novu_auth.server' => 'https://auth.test',
            'services.novu_auth.client_id' => 'client-1',
            'services.novu_auth.client_secret' => 'client-secret',
            'services.novu_auth.app_url' => 'https://dashboard.test',
            'nyrus.allowed_domain' => 'novu.ch',
        ]);
        $this->app->forgetInstance(NovuSso::class);
    }

    /** Starts the login and returns the state the dashboard sent to novu SSO. */
    private function startLogin(): string
    {
        $location = $this->get('/sso')->assertRedirect()->headers->get('Location');
        $this->assertStringStartsWith('https://auth.test/oauth/authorize?', $location);
        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);
        $this->assertSame('client-1', $query['client_id']);
        $this->assertSame('https://dashboard.test/sso/check', $query['redirect_uri']);
        $this->assertSame('code', $query['response_type']);

        return $query['state'];
    }

    private function fakeAuthServer(array $me, int $tokenStatus = 200): void
    {
        Http::fake([
            'auth.test/oauth/token' => Http::response(
                $tokenStatus === 200 ? ['access_token' => 'tok-1', 'token_type' => 'Bearer'] : ['error' => 'invalid_grant'],
                $tokenStatus,
            ),
            'auth.test/api/me' => Http::response($me),
        ]);
    }

    public function test_guests_go_straight_to_sso(): void
    {
        $this->get('/')->assertRedirect('/sso');
    }

    public function test_without_oauth_client_the_login_page_explains(): void
    {
        config(['services.novu_auth.client_id' => null]);
        $this->app->forgetInstance(NovuSso::class);

        $this->get('/')->assertRedirect('/login');
        $this->get('/login')->assertOk()->assertSee('NOVU_AUTH_CLIENT_ID');
        $this->get('/sso')->assertRedirect('/login');
    }

    public function test_novu_account_signs_in(): void
    {
        $this->fakeAuthServer(['id' => 7, 'name' => 'Robin Test', 'email' => 'Robin@novu.ch']);
        $state = $this->startLogin();

        $this->get("/sso/check?code=abc&state={$state}")->assertRedirect(route('dashboard'));

        $this->assertAuthenticated();
        $user = User::firstWhere('email', 'robin@novu.ch');
        $this->assertSame('Robin Test', $user->name);
        $this->assertTrue(AuditLog::where('action', 'login')->where('subject', 'robin@novu.ch')->exists());

        Http::assertSent(fn (Request $r) => $r->url() === 'https://auth.test/oauth/token'
            && $r['grant_type'] === 'authorization_code'
            && $r['code'] === 'abc'
            && $r['client_id'] === 'client-1'
            && $r['client_secret'] === 'client-secret'
            && $r['redirect_uri'] === 'https://dashboard.test/sso/check');
        Http::assertSent(fn (Request $r) => $r->url() === 'https://auth.test/api/me'
            && $r->hasHeader('Authorization', 'Bearer tok-1'));
    }

    public function test_email_nested_under_data_is_accepted(): void
    {
        $this->fakeAuthServer(['data' => ['email' => 'anna@novu.ch']]);
        $state = $this->startLogin();

        $this->get("/sso/check?code=abc&state={$state}")->assertRedirect(route('dashboard'));
        $this->assertSame('anna', User::firstWhere('email', 'anna@novu.ch')->name);
    }

    public function test_returns_to_the_page_that_was_asked_for(): void
    {
        $this->fakeAuthServer(['email' => 'robin@novu.ch']);
        $this->get('/settings')->assertRedirect('/sso');
        $state = $this->startLogin();

        $this->get("/sso/check?code=abc&state={$state}")->assertRedirect(route('settings.index'));
    }

    public function test_wrong_state_is_rejected(): void
    {
        $this->fakeAuthServer(['email' => 'robin@novu.ch']);
        $this->startLogin();

        $this->get('/sso/check?code=abc&state=forged')->assertRedirect('/login?error=1');
        $this->assertGuest();
        Http::assertNothingSent();
    }

    public function test_callback_without_started_login_is_rejected(): void
    {
        $this->fakeAuthServer(['email' => 'robin@novu.ch']);

        $this->get('/sso/check?code=abc&state=x')->assertRedirect('/login?error=1');
        $this->assertGuest();
    }

    public function test_failed_token_exchange_is_rejected(): void
    {
        $this->fakeAuthServer(['email' => 'robin@novu.ch'], tokenStatus: 400);
        $state = $this->startLogin();

        $this->get("/sso/check?code=bad&state={$state}")->assertRedirect('/login?error=1');
        $this->assertGuest();
        $this->get('/login?error=1')->assertSee('hat nicht geklappt');
    }

    public function test_auth_server_error_is_rejected(): void
    {
        $this->fakeAuthServer(['email' => 'robin@novu.ch']);
        $state = $this->startLogin();

        $this->get("/sso/check?error=access_denied&state={$state}")->assertRedirect('/login?error=1');
        $this->assertGuest();
    }

    public function test_other_domains_are_rejected(): void
    {
        $this->fakeAuthServer(['email' => 'extern@kunde.ch']);
        $state = $this->startLogin();

        $this->get("/sso/check?code=abc&state={$state}")->assertRedirect('/login?error=1');
        $this->assertGuest();
        $this->assertDatabaseCount('users', 0);
    }

    public function test_empty_domain_allows_everyone_sso_vouches_for(): void
    {
        config(['nyrus.allowed_domain' => '']);
        $this->fakeAuthServer(['email' => 'extern@kunde.ch']);
        $state = $this->startLogin();

        $this->get("/sso/check?code=abc&state={$state}")->assertRedirect(route('dashboard'));
        $this->assertAuthenticated();
    }

    public function test_logout_shows_the_login_page_instead_of_signing_in_again(): void
    {
        $this->actingAs(User::factory()->create());

        $this->post('/logout')->assertRedirect('/login?logout=1');
        $this->get('/login?logout=1')->assertOk()->assertSee('abgemeldet')->assertSee('Mit novu anmelden');
    }

    public function test_dev_login_is_hidden_outside_local(): void
    {
        config(['nyrus.dev_login' => true]);
        $this->get('/login')->assertDontSee('Lokal ohne SSO');
        $this->post('/auth/dev')->assertNotFound();
    }
}
