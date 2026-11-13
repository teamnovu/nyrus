<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\NovuSso;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\View\View;
use Throwable;

/**
 * Sign-in with novu SSO (auth.novu.ch), like the AI-Usage-Collector. Visitors
 * without a session go straight to SSO; /login is shown after logout, a failed
 * login, or while no OAuth client is configured.
 */
class SsoController extends Controller
{
    private const STATE_KEY = 'novu_sso_state';

    public function __construct(private readonly NovuSso $sso) {}

    public function login(Request $request): View|RedirectResponse
    {
        if (Auth::check()) {
            return redirect()->route('dashboard');
        }

        return view('auth.login', [
            'configured' => $this->sso->isConfigured(),
            'failed' => $request->query->has('error'),
            'devLogin' => $this->devLoginEnabled(),
        ]);
    }

    /** Starts the SSO login; novu SSO sends the browser back to /sso/check. */
    public function redirect(Request $request): RedirectResponse
    {
        if (! $this->sso->isConfigured()) {
            return redirect()->route('login');
        }

        $state = Str::random(40);
        $request->session()->put(self::STATE_KEY, $state);

        return redirect()->away($this->sso->authorizeUrl($this->sso->callbackUrl($request->getSchemeAndHttpHost()), $state));
    }

    public function callback(Request $request): RedirectResponse
    {
        $expected = $request->session()->pull(self::STATE_KEY);
        $state = $request->query('state');

        try {
            if (! is_string($expected) || ! is_string($state) || ! hash_equals($expected, $state)) {
                throw new \RuntimeException('state mismatch (login not started here, or started twice)');
            }
            if (is_string($request->query('error'))) {
                throw new \RuntimeException('auth server: '.$request->query('error'));
            }
            $code = $request->query('code');
            if (! is_string($code) || $code === '') {
                throw new \RuntimeException('no code in callback');
            }

            $person = $this->sso->userFor($code, $this->sso->callbackUrl($request->getSchemeAndHttpHost()));
        } catch (Throwable $e) {
            Log::warning('novu SSO login failed: '.$e->getMessage());

            return redirect()->route('login', ['error' => 1]);
        }

        $domain = strtolower((string) config('nyrus.allowed_domain'));
        if ($domain !== '' && ! str_ends_with($person['email'], '@'.$domain)) {
            Log::warning('novu SSO login rejected: '.$person['email'].' is not @'.$domain);

            return redirect()->route('login', ['error' => 1])->with('error', "Nur Konten mit @{$domain} haben Zugang.");
        }

        $user = User::updateOrCreate(
            ['email' => $person['email']],
            ['name' => $person['name'] ?? Str::before($person['email'], '@'), 'email_verified_at' => now()],
        );

        Auth::login($user, remember: true);
        $request->session()->regenerate();
        AuditLog::record('login', $person['email']);

        return redirect()->intended(route('dashboard'));
    }

    /** Local development only: sign in as a test user without SSO. */
    public function devLogin(Request $request): RedirectResponse
    {
        abort_unless($this->devLoginEnabled(), 404);

        $domain = config('nyrus.allowed_domain') ?: 'novu.ch';
        $user = User::firstOrCreate(
            ['email' => "dev@{$domain}"],
            ['name' => 'Dev User', 'email_verified_at' => now()],
        );
        Auth::login($user);
        $request->session()->regenerate();

        return redirect()->route('dashboard');
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login', ['logout' => 1]);
    }

    private function devLoginEnabled(): bool
    {
        return app()->environment('local') && config('nyrus.dev_login');
    }
}
