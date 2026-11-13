<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * OAuth 2 authorization-code flow against novu SSO (auth.novu.ch, Laravel
 * Passport), as in the AI-Usage-Collector. An "OAuth Client" created there
 * provides client id and secret; its redirect URI must be NOVU_APP_URL +
 * /sso/check. The signed-in person's email comes from GET /api/me.
 */
class NovuSso
{
    public const CHECK_PATH = '/sso/check';

    public function __construct(
        private readonly string $server,
        private readonly ?string $clientId,
        private readonly ?string $clientSecret,
        private readonly ?string $appUrl,
    ) {}

    public static function fromConfig(): self
    {
        return new self(
            rtrim((string) config('services.novu_auth.server'), '/'),
            config('services.novu_auth.client_id'),
            config('services.novu_auth.client_secret'),
            config('services.novu_auth.app_url'),
        );
    }

    public function isConfigured(): bool
    {
        return filled($this->clientId) && filled($this->clientSecret);
    }

    /** Must equal the redirect URI of the OAuth client, character for character. */
    public function callbackUrl(string $requestBaseUrl): string
    {
        return rtrim(filled($this->appUrl) ? (string) $this->appUrl : $requestBaseUrl, '/').self::CHECK_PATH;
    }

    public function authorizeUrl(string $callbackUrl, string $state): string
    {
        return $this->server.'/oauth/authorize?'.http_build_query([
            'client_id' => $this->clientId,
            'redirect_uri' => $callbackUrl,
            'response_type' => 'code',
            'scope' => '',
            'state' => $state,
        ], '', '&', PHP_QUERY_RFC3986);
    }

    /**
     * Exchanges the code for an access token and returns the person's email and name.
     *
     * @return array{email: string, name: ?string}
     *
     * @throws RuntimeException with a reason that is safe to log (never the secret or tokens)
     */
    public function userFor(string $code, string $callbackUrl): array
    {
        $token = Http::asForm()->acceptJson()->timeout(10)->post($this->server.'/oauth/token', [
            'grant_type' => 'authorization_code',
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret,
            'redirect_uri' => $callbackUrl,
            'code' => $code,
        ]);
        $accessToken = $token->json('access_token');
        if (! $token->ok() || ! is_string($accessToken)) {
            throw new RuntimeException(sprintf('token request failed (HTTP %d, %s)', $token->status(), (string) ($token->json('error') ?? 'no access_token')));
        }

        $me = Http::acceptJson()->withToken($accessToken)->timeout(10)->get($this->server.'/api/me');
        if (! $me->ok()) {
            throw new RuntimeException(sprintf('/api/me failed (HTTP %d)', $me->status()));
        }

        foreach (['', 'data.', 'user.'] as $prefix) {
            $email = $me->json($prefix.'email');
            if (is_string($email) && filter_var($email, FILTER_VALIDATE_EMAIL) !== false) {
                $name = $me->json($prefix.'name');

                return ['email' => strtolower($email), 'name' => is_string($name) && $name !== '' ? $name : null];
            }
        }

        throw new RuntimeException('/api/me returned no email (keys: '.implode(', ', array_keys((array) $me->json())).')');
    }
}
