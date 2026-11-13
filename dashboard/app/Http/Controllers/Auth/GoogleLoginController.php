<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;
use Laravel\Socialite\Facades\Socialite;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirect;
use Throwable;

/**
 * Sign-in with Google, limited to accounts of the configured domain
 * (DASHBOARD_ALLOWED_DOMAIN, default novu.ch).
 */
class GoogleLoginController extends Controller
{
    public function show(): View|RedirectResponse
    {
        if (Auth::check()) {
            return redirect()->route('dashboard');
        }

        return view('auth.login', [
            'devLogin' => $this->devLoginEnabled(),
            'domain' => config('nyrus.allowed_domain'),
        ]);
    }

    public function redirect(): SymfonyRedirect
    {
        return Socialite::driver('google')
            ->with(['hd' => config('nyrus.allowed_domain'), 'prompt' => 'select_account'])
            ->redirect();
    }

    public function callback(): RedirectResponse
    {
        try {
            $google = Socialite::driver('google')->user();
        } catch (Throwable $e) {
            report($e);

            return redirect()->route('login')->with('error', 'Die Anmeldung mit Google ist fehlgeschlagen. Bitte nochmals versuchen.');
        }

        $domain = strtolower((string) config('nyrus.allowed_domain'));
        $email = strtolower((string) $google->getEmail());
        $hostedDomain = strtolower((string) ($google->user['hd'] ?? ''));
        $verified = ($google->user['email_verified'] ?? $google->user['verified_email'] ?? false) === true;

        if ($domain === '' || ! str_ends_with($email, '@'.$domain) || $hostedDomain !== $domain || ! $verified) {
            return redirect()->route('login')->with('error', "Nur Konten mit @{$domain} haben Zugang.");
        }

        $user = User::updateOrCreate(
            ['email' => $email],
            [
                'name' => $google->getName() ?: $email,
                'google_id' => $google->getId(),
                'avatar' => $google->getAvatar(),
                'email_verified_at' => now(),
            ],
        );

        Auth::login($user, remember: true);
        request()->session()->regenerate();
        AuditLog::record('login', $email);

        return redirect()->intended(route('dashboard'));
    }

    /** Local development only: sign in as a test user without Google. */
    public function devLogin(Request $request): RedirectResponse
    {
        abort_unless($this->devLoginEnabled(), 404);

        $domain = config('nyrus.allowed_domain');
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

        return redirect()->route('login');
    }

    private function devLoginEnabled(): bool
    {
        return app()->environment('local') && config('nyrus.dev_login');
    }
}
