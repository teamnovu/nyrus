<?php

namespace App\Services;

use App\Exceptions\NyrusException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * HTTP client for the nyrus process on the same server.
 *
 * Reads go to /status, /version and /api/dashboard/*; writes to
 * /api/dashboard/repository* and /api/update/cyrus-env. Every /api call
 * carries the shared CYRUS_API_KEY as Bearer token.
 */
class NyrusClient
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly ?string $apiKey,
        private readonly int $timeout = 10,
    ) {}

    public static function fromConfig(): self
    {
        return new self(
            rtrim((string) config('nyrus.url'), '/'),
            config('nyrus.api_key'),
            (int) config('nyrus.timeout', 10),
        );
    }

    public function hasApiKey(): bool
    {
        return filled($this->apiKey);
    }

    /**
     * Whether nyrus is reachable and busy, idle or down. Never throws.
     *
     * @return array{state: 'idle'|'busy'|'down', version: ?string}
     */
    public function health(): array
    {
        try {
            $status = $this->http()->get('/status');
            if (! $status->ok()) {
                return ['state' => 'down', 'version' => null];
            }
            $version = $this->http()->get('/version');

            return [
                'state' => $status->json('status') === 'idle' ? 'idle' : 'busy',
                'version' => $version->ok() ? $version->json('cyrus_cli_version') : null,
            ];
        } catch (ConnectionException) {
            return ['state' => 'down', 'version' => null];
        }
    }

    /** @return list<array<string, mixed>> */
    public function sessions(): array
    {
        return $this->api('get', '/api/dashboard/sessions')['sessions'] ?? [];
    }

    /** @return array{session: array<string, mixed>, entries: list<array<string, mixed>>} */
    public function session(string $id): array
    {
        return $this->api('get', '/api/dashboard/session', ['id' => $id]);
    }

    /** @return array{repositories: list<array<string, mixed>>, settingKeys: list<string>} */
    public function config(): array
    {
        return $this->api('get', '/api/dashboard/config');
    }

    /** @return array{exists: bool, keys: list<array{key: string, hasValue: bool}>} */
    public function envKeys(): array
    {
        return $this->api('get', '/api/dashboard/env');
    }

    /**
     * Status of the inBudget repository sync, or null if nyrus has no
     * inBudget integration (INBUDGET_URL not set). Never throws.
     *
     * @return array<string, mixed>|null
     */
    public function inbudget(): ?array
    {
        try {
            return $this->api('get', '/api/dashboard/inbudget')['status'] ?? null;
        } catch (NyrusException) {
            return null;
        }
    }

    /**
     * Sync repositories from inBudget now; returns the status (still
     * running if the sync takes long, e.g. while cloning).
     *
     * @return array<string, mixed>
     */
    public function syncInbudget(): array
    {
        return $this->api('post', '/api/dashboard/inbudget', [], timeout: 60)['status'] ?? [];
    }

    /** @param  array<string, mixed>  $repository */
    public function addRepository(array $repository): array
    {
        return $this->api('post', '/api/dashboard/repository', $repository, timeout: 300);
    }

    /** @param  array<string, mixed>  $routing */
    public function updateRouting(array $routing): array
    {
        return $this->api('post', '/api/dashboard/repository/routing', $routing);
    }

    public function removeRepository(string $name, bool $deleteFiles): array
    {
        return $this->api('delete', '/api/dashboard/repository', [
            'name' => $name,
            'deleteFiles' => $deleteFiles,
        ]);
    }

    /** @param  array<string, string>  $variables */
    public function updateEnv(array $variables): array
    {
        return $this->api('post', '/api/update/cyrus-env', [
            'variables' => $variables,
            'backupEnv' => true,
        ]);
    }

    /** @return array{isInstalled?: bool, isAuthenticated?: bool} */
    public function checkGh(): array
    {
        return $this->api('post', '/api/check-gh', []);
    }

    private function http(?int $timeout = null): PendingRequest
    {
        return Http::baseUrl($this->baseUrl)
            ->acceptJson()
            ->timeout($timeout ?? $this->timeout);
    }

    /**
     * Call a nyrus /api endpoint and return its `data`.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     *
     * @throws NyrusException
     */
    private function api(string $method, string $path, array $payload = [], ?int $timeout = null): array
    {
        if (! $this->hasApiKey()) {
            throw new NyrusException('NYRUS_API_KEY is not set in the dashboard .env.');
        }

        try {
            $request = $this->http($timeout)->withToken((string) $this->apiKey);
            /** @var Response $response */
            $response = match ($method) {
                'get' => $request->get($path, $payload),
                'post' => $request->post($path, $payload),
                'delete' => $request->delete($path, $payload),
            };
        } catch (ConnectionException $e) {
            throw new NyrusException('nyrus is not reachable at '.$this->baseUrl.'.', previous: $e);
        }

        if ($response->status() === 401) {
            throw new NyrusException('nyrus rejected the API key. NYRUS_API_KEY must match CYRUS_API_KEY in nyrus\'s ~/.cyrus/.env.');
        }

        if (! $response->json('success')) {
            $message = $response->json('error') ?? 'nyrus returned HTTP '.$response->status().'.';
            $details = $response->json('details');
            throw new NyrusException($details ? "{$message} {$details}" : $message);
        }

        return $response->json('data') ?? [];
    }
}
