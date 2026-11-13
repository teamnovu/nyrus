<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;
use Mockery;
use Tests\TestCase;

class GoogleLoginTest extends TestCase
{
    use RefreshDatabase;

    private function fakeGoogleUser(string $email, ?string $hd, bool $verified = true): void
    {
        $user = (new SocialiteUser)->setRaw([
            'hd' => $hd,
            'email_verified' => $verified,
        ])->map([
            'id' => 'google-123',
            'name' => 'Robin Test',
            'email' => $email,
            'avatar' => 'https://example.com/a.png',
        ]);

        $provider = Mockery::mock(\Laravel\Socialite\Contracts\Provider::class);
        $provider->shouldReceive('user')->andReturn($user);
        Socialite::shouldReceive('driver')->with('google')->andReturn($provider);
    }

    public function test_guests_are_sent_to_the_login_page(): void
    {
        $this->get('/')->assertRedirect('/login');
        $this->get('/login')->assertOk()->assertSee('Mit Google anmelden');
    }

    public function test_dev_login_is_hidden_outside_local(): void
    {
        config(['nyrus.dev_login' => true]);
        $this->get('/login')->assertDontSee('Lokal ohne Google');
        $this->post('/auth/dev')->assertNotFound();
    }

    public function test_novu_account_signs_in_and_is_logged(): void
    {
        $this->fakeGoogleUser('Robin@novu.ch', 'novu.ch');

        $this->get('/auth/google/callback')->assertRedirect(route('dashboard'));

        $this->assertAuthenticated();
        $user = User::firstWhere('email', 'robin@novu.ch');
        $this->assertSame('google-123', $user->google_id);
        $this->assertTrue(AuditLog::where('action', 'login')->exists());
    }

    public function test_other_domains_are_rejected(): void
    {
        $this->fakeGoogleUser('someone@gmail.com', null);

        $this->get('/auth/google/callback')->assertRedirect('/login');

        $this->assertGuest();
        $this->assertDatabaseCount('users', 0);
    }

    public function test_novu_address_without_matching_workspace_is_rejected(): void
    {
        // Email claims novu.ch, but the account is not in the novu.ch Google Workspace
        $this->fakeGoogleUser('robin@novu.ch', 'other.ch');

        $this->get('/auth/google/callback')->assertRedirect('/login');
        $this->assertGuest();
    }

    public function test_unverified_email_is_rejected(): void
    {
        $this->fakeGoogleUser('robin@novu.ch', 'novu.ch', verified: false);

        $this->get('/auth/google/callback')->assertRedirect('/login');
        $this->assertGuest();
    }
}
