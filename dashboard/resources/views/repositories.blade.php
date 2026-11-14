<x-app title="Repositories">
    <p class="eyebrow">Konfiguration</p>
    <h1 class="page-title">Repositories</h1>
    <p class="muted mt-2 text-sm">Woran nyrus arbeitet und welche Tickets in welches Repository gehen. Änderungen übernimmt nyrus ohne Neustart.</p>

    @if ($error)
        <div class="notice mt-6">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>Konfiguration konnte nicht geladen werden: {{ $error }}</span>
        </div>
    @endif

    @if ($inbudget)
        @php($result = $inbudget['result'] ?? [])
        @php($warnings = $inbudget['warnings'] ?? [])
        @php($unrouted = $inbudget['unrouted'] ?? [])
        @php($cloneErrors = $result['errors'] ?? [])
        <div class="card mt-8 p-5 sm:p-6">
            <div class="flex flex-wrap items-start gap-4">
                <div class="min-w-0">
                    <h2 class="text-lg">inBudget</h2>
                    <p class="muted mt-1 text-sm">Repositories und Routing kommen aus den Projekten in inBudget: Git-Link plus Jira- oder ClickUp-Link. Ein Repository, das du hier selbst für denselben Tracker einrichtest, hat Vorrang.</p>
                </div>
                <form method="POST" action="{{ route('repositories.inbudget-sync') }}" class="ml-auto" data-busy-form>
                    @csrf
                    <button class="btn" data-busy-label="Gleiche ab…" @disabled($inbudget['running'] ?? false)>Jetzt abgleichen</button>
                </form>
            </div>
            <div class="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                @if ($inbudget['running'] ?? false)
                    <span class="text-gold">Abgleich läuft…</span>
                @endif
                @if ($inbudget['lastSuccessAt'] ?? null)
                    <span class="muted">Zuletzt: {{ \Illuminate\Support\Carbon::parse($inbudget['lastSuccessAt'])->timezone(config('app.timezone'))->format('d.m.Y H:i') }}</span>
                    <span class="muted">{{ $inbudget['projectCount'] ?? 0 }} aktive Projekte</span>
                    <span class="muted">{{ count($inbudget['repositories'] ?? []) }} Repositories</span>
                @elseif (! ($inbudget['running'] ?? false) && ! ($inbudget['error'] ?? null))
                    <span class="muted">Noch nicht abgeglichen.</span>
                @endif
                @foreach (['added' => 'neu', 'updated' => 'geändert', 'reactivated' => 'wieder aktiv', 'deactivated' => 'deaktiviert'] as $key => $label)
                    @if (! empty($result[$key]))
                        <span class="text-white/80">{{ count($result[$key]) }} {{ $label }}</span>
                    @endif
                @endforeach
            </div>
            @if ($inbudget['error'] ?? null)
                <div class="notice mt-4">
                    <span class="notice-dot text-warning" aria-hidden="true"></span>
                    <span>Letzter Abgleich fehlgeschlagen: {{ $inbudget['error'] }}</span>
                </div>
            @endif
            @foreach ($cloneErrors as $cloneError)
                <div class="notice mt-3">
                    <span class="notice-dot text-warning" aria-hidden="true"></span>
                    <span><span class="font-mono">{{ $cloneError['repository'] }}</span> konnte nicht geklont werden: {{ $cloneError['message'] }}</span>
                </div>
            @endforeach
            @if (count($warnings))
                <details class="mt-4">
                    <summary class="link cursor-pointer text-sm">{{ count($warnings) }} Projekte mit Links, die nyrus nicht nutzen kann</summary>
                    <ul class="muted mt-2 space-y-1 text-sm">
                        @foreach ($warnings as $warning)
                            <li><span class="text-white/80">{{ $warning['project'] }}</span>: {{ $warning['message'] }}</li>
                        @endforeach
                    </ul>
                </details>
            @endif
            @if (count($unrouted))
                <details class="mt-2">
                    <summary class="link cursor-pointer text-sm">{{ count($unrouted) }} Projekte mit Repository, aber ohne Jira- oder ClickUp-Link</summary>
                    <p class="muted mt-2 text-sm">{{ implode(' · ', $unrouted) }}</p>
                </details>
            @endif
        </div>
    @endif

    <div class="card divided mt-8 overflow-hidden">
        @forelse ($repositories as $repo)
            @php($name = $repo['name'] ?? $repo['id'])
            @php($managed = str_starts_with($repo['id'] ?? '', 'inbudget-'))
            <details class="group" @if (old('_repo') === $name) open @endif>
                <summary class="card-row flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
                    <div class="min-w-0">
                        <div class="font-medium text-white">{{ $name }}</div>
                        <div class="muted mt-0.5 text-xs"><span class="font-mono">{{ $repo['baseBranch'] ?? 'main' }}</span>@if (! empty($repo['teamKeys'])) · {{ implode(', ', $repo['teamKeys']) }}@endif @if (! empty($repo['projectKeys'])) · {{ implode(', ', $repo['projectKeys']) }}@endif</div>
                    </div>
                    @if ($managed)
                        <span class="chip text-white/70">inBudget</span>
                    @endif
                    @if (($repo['isActive'] ?? true) === false)
                        <span class="chip text-white/50">inaktiv</span>
                    @else
                        <span class="chip text-gold"><span class="chip-dot"></span>aktiv</span>
                    @endif
                    <div class="ml-auto flex items-center gap-4">
                        @if ($repo['githubUrl'] ?? null)
                            <a href="{{ $repo['githubUrl'] }}" target="_blank" rel="noopener" class="link text-sm">GitHub</a>
                        @endif
                        <svg class="size-4 text-white/35 transition-transform duration-200 group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/></svg>
                    </div>
                </summary>
                <div class="border-t border-white/[0.06] bg-canvas/40 px-5 py-5">
                    <form method="POST" action="{{ route('repositories.update', $name) }}" class="grid gap-4 sm:grid-cols-2">
                        @csrf
                        @method('PUT')
                        <input type="hidden" name="_repo" value="{{ $name }}">
                        @if ($managed)
                            <p class="muted text-xs sm:col-span-2">Routing kommt aus inBudget{{ empty($inbudgetProjects[$repo['id']]) ? '' : ' ('.implode(', ', $inbudgetProjects[$repo['id']]).')' }}. Team-Keys und Projekte änderst du dort; Basis-Branch und aktiv bleiben hier.</p>
                        @endif
                        <label class="label">Basis-Branch
                            <input name="baseBranch" value="{{ $repo['baseBranch'] ?? 'main' }}" class="field font-mono">
                        </label>
                        <label class="label">Projekte (kommagetrennt)
                            <input name="projectKeys" value="{{ implode(', ', $repo['projectKeys'] ?? []) }}" class="field" @readonly($managed)>
                        </label>
                        <label class="label">Team-Keys (kommagetrennt)
                            <input name="teamKeys" value="{{ implode(', ', $repo['teamKeys'] ?? []) }}" class="field" @readonly($managed)>
                        </label>
                        <label class="label">Routing-Labels (kommagetrennt)
                            <input name="routingLabels" value="{{ implode(', ', $repo['routingLabels'] ?? []) }}" class="field">
                        </label>
                        <label class="flex items-center gap-2.5 text-sm text-white/80">
                            <input type="hidden" name="isActive" value="0">
                            <input type="checkbox" name="isActive" value="1" @checked($repo['isActive'] ?? true) class="size-4 accent-gold"> aktiv
                        </label>
                        <div class="muted text-xs sm:col-span-2">Pfad: <span class="font-mono">{{ $repo['repositoryPath'] ?? '–' }}</span></div>
                        <div class="sm:col-span-2">
                            <button class="btn">Routing speichern</button>
                        </div>
                    </form>
                    <form method="POST" action="{{ route('repositories.destroy', $name) }}" class="mt-6 flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-5"
                          onsubmit="return confirm('{{ $name }} aus nyrus entfernen?')">
                        @csrf
                        @method('DELETE')
                        <label class="flex items-center gap-2 text-sm text-white/60">
                            <input type="checkbox" name="deleteFiles" value="1" class="size-4 accent-danger"> auch den Klon auf dem Server löschen
                        </label>
                        @if ($managed)
                            <span class="muted text-xs">Kommt beim nächsten Abgleich wieder, solange das Projekt in inBudget verknüpft ist. Zum Pausieren „aktiv“ ausschalten.</span>
                        @endif
                        <button class="btn-danger ml-auto">Entfernen</button>
                    </form>
                </div>
            </details>
        @empty
            <div class="px-5 py-12 text-center">
                <p class="font-medium text-white">Noch keine Repositories.</p>
                <p class="muted mt-1 text-sm">Füge unten das erste hinzu.</p>
            </div>
        @endforelse
    </div>

    <div class="card mt-10 p-5 sm:p-6">
        <h2 class="text-lg">Repository hinzufügen</h2>
        <p class="muted mt-1 text-sm">nyrus klont das Repository auf dem Server (über <span class="font-mono">gh</span>, der Bot-Account braucht Zugriff). Das kann einen Moment dauern.</p>
        <form method="POST" action="{{ route('repositories.store') }}" class="mt-6 grid gap-4 sm:grid-cols-2" data-busy-form>
            @csrf
            <label class="label sm:col-span-2">Git-URL
                <input name="repository_url" value="{{ old('repository_url') }}" required placeholder="https://github.com/teamnovu/projekt.git" class="field font-mono">
            </label>
            <label class="label">Name (optional, sonst aus der URL)
                <input name="name" value="{{ old('name') }}" class="field">
            </label>
            <label class="label">Basis-Branch
                <input name="baseBranch" value="{{ old('baseBranch', 'main') }}" class="field font-mono">
            </label>
            <label class="label">Projekte (kommagetrennt)
                <input name="projectKeys" value="{{ old('projectKeys') }}" class="field">
            </label>
            <label class="label">Routing-Labels (kommagetrennt)
                <input name="routingLabels" value="{{ old('routingLabels') }}" class="field">
            </label>
            <div class="sm:col-span-2">
                <button class="btn" data-busy-label="Klone…">Hinzufügen</button>
            </div>
        </form>
    </div>
</x-app>
