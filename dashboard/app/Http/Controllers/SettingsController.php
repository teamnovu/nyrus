<?php

namespace App\Http\Controllers;

use App\Exceptions\NyrusException;
use App\Models\AuditLog;
use App\Services\NyrusClient;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Variables in nyrus's ~/.cyrus/.env. Values are write-only: the dashboard
 * shows which variables are set, never their contents.
 */
class SettingsController extends Controller
{
    /** Changing these from the dashboard would lock it out of nyrus or move nyrus. */
    public const PROTECTED_KEYS = ['CYRUS_API_KEY', 'CYRUS_SERVER_PORT', 'CYRUS_HOST_EXTERNAL'];

    /** Variables worth setting on Forge, with a short German hint. */
    public const KNOWN_KEYS = [
        'ANTHROPIC_API_KEY' => 'Claude-API-Key (oder CLAUDE_CODE_OAUTH_TOKEN)',
        'CLAUDE_CODE_OAUTH_TOKEN' => 'Token eines Claude-Abos (claude setup-token)',
        'GITHUB_TOKEN' => 'Token des GitHub-Bot-Accounts für Pull Requests',
        'CYRUS_BASE_URL' => 'Öffentliche URL für Webhooks',
        'SLACK_BOT_TOKEN' => 'Slack-Bot-Token (xoxb-…)',
        'SLACK_SIGNING_SECRET' => 'Slack Signing Secret',
        'SLACK_DIRECT_WEBHOOKS' => 'true: Slack-Signatur prüfen, auch mit CYRUS_API_KEY',
        'CYRUS_LOG_LEVEL' => 'Log-Level, z.B. info oder debug',
    ];

    public function index(NyrusClient $nyrus): View
    {
        $env = ['exists' => false, 'keys' => []];
        $gh = null;
        $error = null;

        try {
            $env = $nyrus->envKeys();
            $gh = $nyrus->checkGh();
        } catch (NyrusException $e) {
            $error = $e->getMessage();
        }

        $set = collect($env['keys'])->keyBy('key');

        return view('settings', [
            'env' => $env,
            'set' => $set,
            'known' => self::KNOWN_KEYS,
            'protected' => self::PROTECTED_KEYS,
            'gh' => $gh,
            'error' => $error,
        ]);
    }

    public function update(Request $request, NyrusClient $nyrus): RedirectResponse
    {
        $data = $request->validate([
            'key' => ['required', 'string', 'max:100', 'regex:/^[A-Z][A-Z0-9_]*$/'],
            'value' => ['required', 'string', 'max:4000', 'not_regex:/[\r\n]/'],
        ], [
            'key.regex' => 'Nur Grossbuchstaben, Ziffern und _ (z.B. GITHUB_TOKEN).',
            'value.not_regex' => 'Der Wert darf keine Zeilenumbrüche enthalten.',
        ]);

        if (in_array($data['key'], self::PROTECTED_KEYS, true)) {
            return back()->with('error', "{$data['key']} lässt sich nur auf dem Server ändern.");
        }

        try {
            $nyrus->updateEnv([$data['key'] => $data['value']]);
        } catch (NyrusException $e) {
            AuditLog::record('env.set', $data['key'], ['error' => $e->getMessage()], success: false);

            return back()->with('error', $e->getMessage());
        }

        // Only the key is logged, never the value.
        AuditLog::record('env.set', $data['key']);

        return redirect()->route('settings.index')->with('status', "{$data['key']} gespeichert. nyrus liest die .env automatisch neu ein.");
    }
}
