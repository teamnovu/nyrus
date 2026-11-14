<?php

namespace App\Services;

/**
 * The sessions nyrus reports (/api/dashboard/sessions), with the source and
 * status group each one belongs to, for filtering and labels.
 *
 * Older nyrus versions send neither `source` nor `state`; then they come from
 * `tracker` and `status`.
 */
class SessionList
{
    public const SOURCES = [
        'linear' => 'Linear',
        'jira' => 'Jira',
        'clickup' => 'ClickUp',
        'github-issue' => 'GitHub Issue',
        'github-pr' => 'GitHub PR',
        'gitlab' => 'GitLab',
        'slack' => 'Slack',
        'zulip' => 'Zulip',
        'plane' => 'Plane',
        'cli' => 'CLI',
        'unknown' => 'Andere',
    ];

    public const STATES = [
        'running' => 'Läuft',
        'waiting' => 'Wartet',
        'finished' => 'Fertig',
        'failed' => 'Fehler',
        'stale' => 'Unterbrochen',
    ];

    /** @param  array<string, mixed>  $session */
    public static function source(array $session): string
    {
        $source = $session['source'] ?? null;
        if (is_string($source) && $source !== '') {
            return $source;
        }

        return match ($session['tracker'] ?? null) {
            null, '' => 'unknown',
            'github' => 'github-pr',
            default => (string) $session['tracker'],
        };
    }

    public static function sourceLabel(string $source): string
    {
        return self::SOURCES[$source] ?? ucfirst($source);
    }

    /** @param  array<string, mixed>  $session */
    public static function state(array $session): string
    {
        $state = $session['state'] ?? null;
        if (is_string($state) && isset(self::STATES[$state])) {
            return $state;
        }

        return match ($session['status'] ?? null) {
            'active' => 'running',
            'pending', 'awaitingInput' => 'waiting',
            'error' => 'failed',
            'stale' => 'stale',
            default => 'finished',
        };
    }

    /**
     * Heading of a session: its ticket, else its title, else its id.
     *
     * @param  array<string, mixed>  $session
     */
    public static function heading(array $session): string
    {
        return $session['issue']['identifier'] ?? $session['title'] ?? $session['issue']['title'] ?? $session['id'];
    }

    /**
     * The title shown next to the heading (none when it is the heading).
     *
     * @param  array<string, mixed>  $session
     */
    public static function subtitle(array $session): ?string
    {
        $title = $session['title'] ?? $session['issue']['title'] ?? null;

        return $title !== null && $title !== self::heading($session) ? $title : null;
    }

    /**
     * Runner and model, e.g. "codex · gpt-5".
     *
     * @param  array<string, mixed>  $session
     */
    public static function engine(array $session): ?string
    {
        $parts = array_filter([$session['runner'] ?? null, $session['model'] ?? null]);

        return $parts ? implode(' · ', array_unique($parts)) : null;
    }
}
