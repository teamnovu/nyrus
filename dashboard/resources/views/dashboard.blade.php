<x-app title="Übersicht">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <p class="eyebrow">Live</p>
            <h1 class="page-title">Übersicht</h1>
            <p class="muted mt-2 text-sm">Zustand von nyrus und alle Sessions, die neueste zuerst.</p>
        </div>
        <div class="flex items-center gap-4">
            <span class="muted hidden text-xs sm:inline" data-live-label>aktualisiert sich automatisch</span>
            <a href="{{ route('dashboard') }}" class="btn-ghost">Aktualisieren</a>
        </div>
    </div>

    <div class="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/[0.07] ring-1 ring-white/[0.07] lg:grid-cols-5" data-live-region>
        <div class="col-span-2 bg-surface p-5 lg:col-span-1">
            <div class="label">nyrus</div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
                <x-status-badge :status="$health['state']" />
                @if ($health['version'])
                    <span class="muted font-mono text-xs">v{{ $health['version'] }}</span>
                @endif
            </div>
            @if ($health['state'] === 'down')
                <p class="mt-3 text-sm text-danger">Prozess antwortet nicht. Daemon in Forge prüfen.</p>
            @endif
        </div>
        @foreach ([
            ['Sessions', $counts['total'], 'text-white'],
            ['Laufen', $counts['active'], 'text-gold'],
            ['Warten auf Antwort', $counts['awaiting'], 'text-white'],
            ['Fehler', $counts['error'], $counts['error'] > 0 ? 'text-danger' : 'text-white'],
        ] as [$label, $value, $color])
            <div class="bg-surface p-5">
                <div class="label">{{ $label }}</div>
                <div class="mt-2 text-3xl font-semibold tabular-nums {{ $color }}">{{ $value }}</div>
            </div>
        @endforeach
    </div>

    @if ($error)
        <div class="notice mt-6">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>Sessions konnten nicht geladen werden: {{ $error }}</span>
        </div>
    @endif

    <div class="mt-12 flex items-baseline justify-between">
        <h2 class="text-lg">Sessions</h2>
        <span class="muted text-xs">{{ count($sessions) }} insgesamt</span>
    </div>

    <div class="card divided mt-3 overflow-hidden" data-live-region>
        @forelse ($sessions as $session)
            @php($ts = $session['lastActivityAt'] ?? $session['updatedAt'])
            <a href="{{ route('sessions.show', $session['id']) }}"
               class="card-row group grid grid-cols-1 items-center gap-2 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:gap-6">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="font-medium text-white">{{ $session['issue']['identifier'] ?? $session['id'] }}</span>
                        @if ($session['issue']['title'] ?? null)
                            <span class="muted truncate text-sm">{{ $session['issue']['title'] }}</span>
                        @endif
                    </div>
                    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/40">
                        @if ($session['tracker'] ?? null)<span>{{ ['jira' => 'Jira', 'linear' => 'Linear', 'clickup' => 'ClickUp', 'slack' => 'Slack', 'github' => 'GitHub', 'gitlab' => 'GitLab', 'plane' => 'Plane'][$session['tracker']] ?? $session['tracker'] }}</span>@endif
                        @if (($session['runtimeMs'] ?? null) !== null)<span class="tabular-nums">{{ max(1, (int) round($session['runtimeMs'] / 60000)) }} min</span>@endif
                        @if ($session['model'] ?? null)<span>{{ $session['model'] }}</span>@endif
                        <span>{{ collect($session['repositories'])->pluck('id')->filter()->join(', ') ?: 'kein Repository' }}</span>
                        <span>{{ $ts ? \Illuminate\Support\Carbon::createFromTimestampMs($ts)->timezone('Europe/Zurich')->diffForHumans() : '–' }}</span>
                    </div>
                </div>
                <x-status-badge :status="$session['status']" class="justify-self-start sm:justify-self-auto" />
                <div class="flex items-center gap-4 justify-self-start sm:justify-self-end">
                    @if ($session['pullRequestUrl'])
                        <span class="text-xs text-gold" title="{{ $session['pullRequestUrl'] }}">Pull Request</span>
                    @endif
                    <svg class="hidden size-4 text-white/25 transition-colors group-hover:text-white/70 sm:block" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clip-rule="evenodd"/></svg>
                </div>
            </a>
        @empty
            <div class="px-5 py-14 text-center">
                <p class="font-medium text-white">Noch keine Sessions.</p>
                <p class="muted mt-1 text-sm">Sobald nyrus ein Ticket bearbeitet, erscheint es hier.</p>
            </div>
        @endforelse
    </div>
</x-app>
