<x-app title="Übersicht">
    @php
        $marks = ['jira' => 'mark-jira', 'clickup' => 'mark-clickup', 'github-issue' => 'mark-github', 'github-pr' => 'mark-github', 'slack' => 'mark-slack'];
        $filterLink = fn (?string $status) => route('dashboard', array_filter(['source' => $filters['source'], 'status' => $status]));
    @endphp
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <p class="eyebrow">Live</p>
            <h1 class="page-title">Übersicht</h1>
            <p class="page-lead">Zustand von nyrus und alle Sessions aus allen Quellen, die neueste zuerst.</p>
        </div>
        <div class="flex items-center gap-3">
            <span class="hidden items-center gap-2 text-xs text-white/50 sm:flex">
                <span class="chip-dot text-success" data-ping aria-hidden="true"></span>
                <span data-live-label>aktualisiert sich automatisch</span>
            </span>
            <a href="{{ route('dashboard') }}" class="btn-ghost" title="Jetzt aktualisieren"><x-icon name="refresh" class="size-4 text-white/60" />Aktualisieren</a>
        </div>
    </div>

    <div class="stats mt-8 grid-cols-2 lg:grid-cols-5" data-live-region>
        <div class="stat col-span-2 lg:col-span-1">
            <div class="label">nyrus</div>
            <div class="mt-2.5 flex flex-wrap items-center gap-2">
                <x-status-badge :status="$health['state']" />
                @if ($health['version'])
                    <span class="font-mono text-xs text-white/45">v{{ $health['version'] }}</span>
                @endif
            </div>
            @if ($health['state'] === 'down')
                <p class="mt-2 text-sm text-danger">Prozess antwortet nicht. Daemon in Forge prüfen.</p>
            @endif
        </div>
        @foreach ([
            ['Sessions', $counts['total'], 'text-white', null, 'bg-white/30'],
            ['Laufen', $counts['active'], $counts['active'] > 0 ? 'text-info' : 'text-white', 'running', 'bg-info'],
            ['Warten', $counts['awaiting'], $counts['awaiting'] > 0 ? 'text-warning' : 'text-white', 'waiting', 'bg-warning'],
            ['Fehler', $counts['error'], $counts['error'] > 0 ? 'text-danger' : 'text-white', 'failed', 'bg-danger'],
        ] as [$label, $value, $color, $status, $bar])
            <a href="{{ $filterLink($status) }}" @class(['stat group relative transition-colors hover:bg-raised', 'bg-raised' => $status !== null && $filters['status'] === $status]) title="{{ $status ? 'Nur diese Sessions zeigen' : 'Alle Sessions zeigen' }}">
                <span class="absolute inset-y-3 left-0 w-0.5 rounded-full {{ $bar }} opacity-70" aria-hidden="true"></span>
                <div class="label flex items-center justify-between">{{ $label }}<x-icon name="chevron-right" class="size-3.5 text-white/0 transition-colors group-hover:text-white/40" /></div>
                <div class="stat-big {{ $color }}">{{ $value }}</div>
            </a>
        @endforeach
    </div>

    @if ($error)
        <div class="notice mt-6 border-warning/30">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>Sessions konnten nicht geladen werden: {{ $error }}</span>
        </div>
    @endif

    {{-- filters: stay on top while scrolling through the sessions --}}
    <div class="sticky-bar mt-10 max-sm:static" data-sticky>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <h2 class="section-title mr-auto">Sessions <span class="count" data-sticky-count>{{ $filtered ? $matchCount : $counts['total'] }}</span></h2>
            <form method="GET" action="{{ route('dashboard') }}" class="flex flex-wrap items-center gap-2">
                <select name="source" aria-label="Quelle" onchange="this.form.submit()" class="select" @if ($filters['source']) data-active @endif>
                    <option value="">Alle Quellen</option>
                    @foreach ($sources as $source => $count)
                        <option value="{{ $source }}" @selected($filters['source'] === $source)>{{ \App\Services\SessionList::sourceLabel($source) }} ({{ $count }})</option>
                    @endforeach
                </select>
                <select name="status" aria-label="Status" onchange="this.form.submit()" class="select" @if ($filters['status']) data-active @endif>
                    <option value="">Alle Status</option>
                    @foreach (\App\Services\SessionList::STATES as $state => $label)
                        <option value="{{ $state }}" @selected($filters['status'] === $state)>{{ $label }} ({{ $states[$state] ?? 0 }})</option>
                    @endforeach
                </select>
                <noscript><button class="btn-ghost">Filtern</button></noscript>
                @if ($filtered)
                    <a href="{{ route('dashboard') }}" class="btn-ghost !px-2.5" title="Filter zurücksetzen"><x-icon name="x" class="size-4 text-white/60" />Zurücksetzen</a>
                @endif
            </form>
        </div>
    </div>

    <div data-live-region>
        <p class="muted mt-3 text-sm tabular-nums" data-result-count>
            @if ($filtered)
                {{ $matchCount }} von {{ $counts['total'] }} Sessions
            @else
                {{ $counts['total'] }} Sessions
            @endif
            @if ($sessions->lastPage() > 1)
                · {{ $sessions->firstItem() }}–{{ $sessions->lastItem() }} angezeigt
            @endif
        </p>

        <div class="card divided mt-3 overflow-hidden">
            @forelse ($sessions as $session)
                @php($ts = $session['lastActivityAt'] ?? $session['updatedAt'] ?? $session['createdAt'] ?? null)
                @php($subtitle = \App\Services\SessionList::subtitle($session))
                @php($engine = \App\Services\SessionList::engine($session))
                @php($source = $session['_source'])
                @php($repos = collect($session['repositories'] ?? [])->pluck('id')->filter()->join(', '))
                @php($pr = $session['pullRequestUrl'] ?? null)
                <a href="{{ route('sessions.show', $session['id']) }}"
                   class="card-row group grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 px-4 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-5">
                    <span class="flex size-8 items-center justify-center rounded-lg border border-line bg-raised" title="{{ \App\Services\SessionList::sourceLabel($source) }}">
                        <span class="mark {{ $marks[$source] ?? 'mark-other' }}"></span>
                    </span>
                    <div class="min-w-0">
                        <div class="flex min-w-0 items-baseline gap-2">
                            <span class="shrink-0 font-medium text-white">{{ \App\Services\SessionList::heading($session) }}</span>
                            @if ($subtitle)
                                <span class="truncate text-sm text-white/65">{{ $subtitle }}</span>
                            @endif
                        </div>
                        <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
                            <span class="text-white/65">{{ \App\Services\SessionList::sourceLabel($source) }}</span>
                            <span class="flex items-center gap-1"><x-icon name="folder" class="size-3.5 text-white/30" />{{ $repos ?: 'kein Repository' }}</span>
                            @if (($session['runtimeMs'] ?? null) !== null)<span class="tabular-nums">{{ max(1, (int) round($session['runtimeMs'] / 60000)) }} min</span>@endif
                            @if ($engine)<span>{{ $engine }}</span>@endif
                            <span @if ($ts) title="{{ \Illuminate\Support\Carbon::createFromTimestampMs($ts)->timezone('Europe/Zurich')->format('d.m.Y H:i') }}" @endif>{{ $ts ? \Illuminate\Support\Carbon::createFromTimestampMs($ts)->timezone('Europe/Zurich')->diffForHumans() : '–' }}</span>
                        </div>
                    </div>
                    <div class="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-auto sm:justify-self-end">
                        <x-status-badge :status="$session['status'] ?? 'unknown'" />
                        @if ($pr)
                            <span class="chip chip-tag" title="{{ $pr }}"><x-icon name="pull" class="size-3.5 text-success" />{{ preg_match('~/pull/(\d+)~', $pr, $m) ? 'PR #'.$m[1] : 'Pull Request' }}</span>
                        @endif
                    </div>
                    <x-icon name="chevron-right" class="hidden size-4 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-white/70 sm:block" />
                </a>
            @empty
                <div class="flex flex-col items-center px-5 py-16 text-center">
                    <x-icon name="inbox" class="size-8 text-white/20" />
                    @if ($filtered)
                        <p class="mt-3 font-medium text-white">Keine Treffer.</p>
                        <p class="muted mt-1 text-sm"><a href="{{ route('dashboard') }}" class="link">Filter zurücksetzen</a></p>
                    @else
                        <p class="mt-3 font-medium text-white">Noch keine Sessions.</p>
                        <p class="muted mt-1 text-sm">Sobald nyrus ein Ticket bearbeitet, erscheint es hier.</p>
                    @endif
                </div>
            @endforelse
        </div>

        <div class="mt-6">
            @include('partials.pagination', ['paginator' => $sessions])
        </div>
    </div>
</x-app>
