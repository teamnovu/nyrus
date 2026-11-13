<x-app title="Übersicht">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <p class="eyebrow">Live</p>
            <h1 class="mt-3 text-5xl sm:text-6xl">Übersicht</h1>
            <p class="muted mt-2 text-sm">Zustand von nyrus und alle Sessions, die neueste zuerst.</p>
        </div>
        <div class="flex items-center gap-3">
            <span class="muted hidden text-xs sm:inline" data-live-label>aktualisiert sich automatisch</span>
            <a href="{{ route('dashboard') }}" class="btn-ghost">
                <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M15.31 4.69a7 7 0 1 0 1.65 7.29.75.75 0 1 1 1.42.48 8.5 8.5 0 1 1-2.01-8.85l.88.88V2.75a.75.75 0 0 1 1.5 0v4.5a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1 0-1.5h2.69l-.88-.81Z" clip-rule="evenodd"/></svg>
                Aktualisieren
            </a>
        </div>
    </div>

    <div class="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-5" data-live-region>
        <div class="glass relative col-span-2 overflow-hidden p-6 lg:col-span-1">
            <div @class([
                'absolute -top-10 -right-10 size-32 rounded-full blur-2xl',
                'bg-gold/40' => $health['state'] !== 'down',
                'bg-danger/40' => $health['state'] === 'down',
            ])></div>
            <div class="label relative">nyrus</div>
            <div class="relative mt-3 flex flex-wrap items-center gap-2">
                <x-status-badge :status="$health['state']" />
                @if ($health['version'])
                    <span class="muted text-xs font-bold">v{{ $health['version'] }}</span>
                @endif
            </div>
            @if ($health['state'] === 'down')
                <p class="relative mt-3 text-sm text-danger">Prozess antwortet nicht. Daemon in Forge prüfen.</p>
            @endif
        </div>
        @foreach ([
            ['Sessions', $counts['total'], 'from-white/20'],
            ['Laufen', $counts['active'], 'from-gold/40'],
            ['Warten auf Antwort', $counts['awaiting'], 'from-warning/40'],
            ['Fehler', $counts['error'], 'from-danger/40'],
        ] as [$label, $value, $glow])
            <div class="glass glass-hover relative overflow-hidden p-6">
                <div class="absolute -right-8 -bottom-12 size-28 rounded-full bg-gradient-to-br {{ $glow }} to-transparent blur-2xl"></div>
                <div class="label relative">{{ $label }}</div>
                <div class="relative mt-2 text-5xl font-extrabold tabular-nums text-white">{{ $value }}</div>
            </div>
        @endforeach
    </div>

    @if ($error)
        <div class="notice mt-6">
            <span class="chip bg-warning/20 text-warning"><span class="chip-dot"></span></span>
            <span>Sessions konnten nicht geladen werden: {{ $error }}</span>
        </div>
    @endif

    <div class="mt-10 flex items-baseline justify-between">
        <h2 class="text-2xl">Sessions</h2>
        <span class="muted text-xs">{{ count($sessions) }} insgesamt</span>
    </div>

    <div class="mt-4 space-y-3" data-live-region>
        @forelse ($sessions as $session)
            @php($ts = $session['lastActivityAt'] ?? $session['updatedAt'])
            <a href="{{ route('sessions.show', $session['id']) }}"
               class="glass glass-hover group grid grid-cols-1 items-center gap-3 px-6 py-5 sm:grid-cols-[1fr_auto_auto] sm:gap-6">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-lg font-extrabold text-white">{{ $session['issue']['identifier'] ?? $session['id'] }}</span>
                        @if ($session['tracker'] ?? null)
                            <span class="chip bg-white/[0.07] text-white/60">{{ $session['tracker'] }}</span>
                        @endif
                    </div>
                    @if ($session['issue']['title'] ?? null)
                        <div class="muted mt-1 truncate text-sm">{{ $session['issue']['title'] }}</div>
                    @endif
                    <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
                        <span>{{ collect($session['repositories'])->pluck('id')->filter()->join(', ') ?: 'kein Repository' }}</span>
                        <span>{{ $ts ? \Illuminate\Support\Carbon::createFromTimestampMs($ts)->timezone('Europe/Zurich')->diffForHumans() : '–' }}</span>
                    </div>
                </div>
                <x-status-badge :status="$session['status']" class="justify-self-start sm:justify-self-auto" />
                <div class="flex items-center gap-3 justify-self-start sm:justify-self-end">
                    @if ($session['pullRequestUrl'])
                        <span class="chip bg-gold/15 text-gold" title="{{ $session['pullRequestUrl'] }}">PR öffnen</span>
                    @endif
                    <svg class="size-5 text-white/30 transition duration-300 group-hover:translate-x-1 group-hover:text-white/80" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clip-rule="evenodd"/></svg>
                </div>
            </a>
        @empty
            <div class="glass px-6 py-14 text-center">
                <div class="mx-auto grid size-12 place-items-center rounded-full bg-gold/15 text-gold">
                    <svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"/></svg>
                </div>
                <p class="mt-4 font-bold text-white">Noch keine Sessions.</p>
                <p class="muted mt-1 text-sm">Sobald nyrus ein Ticket bearbeitet, erscheint es hier.</p>
            </div>
        @endforelse
    </div>
</x-app>
