<x-app title="Projekte">
    @php($openAdd = request()->boolean('add') || old('_form') === 'add')
    @php($selectClass = 'h-9 min-w-0 rounded-lg bg-canvas px-2.5 text-sm text-white/75 ring-1 ring-white/10 outline-none ring-inset focus:ring-gold/60')

    <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-0">
            <p class="eyebrow">Konfiguration</p>
            <h1 class="page-title">Projekte</h1>
        </div>
        <a href="{{ request()->fullUrlWithQuery(['add' => 1]) }}" class="btn ml-auto" data-dialog-open="add-repository">
            <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z"/></svg>
            Repository hinzufügen
        </a>
    </div>
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
        @php($infoCount = $inbudget['infoCount'] ?? null)
        @php($linkCount = $inbudget['linkCount'] ?? null)
        @php($matchedInfoCount = $inbudget['matchedInfoCount'] ?? null)
        <div class="card mt-8 p-5 sm:p-6">
            <div class="flex flex-wrap items-start gap-4">
                <div class="min-w-0 flex-1 basis-72">
                    <h2 class="text-lg">inBudget</h2>
                    <p class="muted mt-1 text-sm">Repositories und Routing kommen aus den Projekten in inBudget: Git-Link plus Jira- oder ClickUp-Link. Ein Repository, das du hier selbst für denselben Tracker einrichtest, hat Vorrang.</p>
                </div>
                <form method="POST" action="{{ route('repositories.inbudget-sync') }}" data-busy-form>
                    @csrf
                    @foreach ($listQuery as $key => $value)
                        <input type="hidden" name="_query[{{ $key }}]" value="{{ $value }}">
                    @endforeach
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
                @if ($infoCount !== null)
                    <span class="muted">{{ $infoCount }} Infos{{ $matchedInfoCount !== null ? ' ('.$matchedInfoCount.' bei aktiven Projekten)' : '' }}</span>
                @endif
                @if ($linkCount !== null)
                    <span @class(['muted' => ! ($infoCount && $linkCount === 0), 'text-warning' => $infoCount && $linkCount === 0])
                          @if ($infoCount && $linkCount === 0) title="Keine der Infos wurde als GitHub-, Jira- oder ClickUp-Link erkannt." @endif>{{ $linkCount }} erkannte Links</span>
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
            @elseif ($infoCount === 0 && ($inbudget['lastSuccessAt'] ?? null) && ! ($inbudget['running'] ?? false))
                <div class="notice mt-4" data-inbudget-no-infos>
                    <span class="notice-dot text-warning" aria-hidden="true"></span>
                    <span>inBudget hat keine Projekt-Infos geliefert – sieht der Token-User die Infos der Projekte?</span>
                </div>
            @endif

            @if (count($cloneErrors))
                <details class="mt-4" @if (count($cloneErrors) <= 3) open @endif>
                    <summary class="cursor-pointer text-sm text-warning">{{ count($cloneErrors) }} {{ count($cloneErrors) === 1 ? 'Repository konnte' : 'Repositories konnten' }} nicht geklont werden</summary>
                    <ul class="mt-2 max-h-60 space-y-1.5 overflow-y-auto rounded-lg bg-canvas/60 p-3 text-sm ring-1 ring-white/[0.06]">
                        @foreach ($cloneErrors as $cloneError)
                            <li class="break-words"><span class="font-mono text-white/80">{{ $cloneError['repository'] }}</span> <span class="muted">konnte nicht geklont werden: {{ $cloneError['message'] }}</span></li>
                        @endforeach
                    </ul>
                </details>
            @endif

            @if (count($warnings))
                <details class="mt-4" data-filter-scope>
                    <summary class="link cursor-pointer text-sm">{{ count($warnings) }} Projekte mit Links, die nyrus nicht nutzen kann</summary>
                    @if (count($warnings) > 8)
                        <input type="search" placeholder="In diesen Projekten suchen…" aria-label="Projekte filtern" data-filter-input class="field !h-9 max-w-sm">
                    @endif
                    <ul class="mt-2 max-h-72 divide-y divide-white/[0.05] overflow-y-auto rounded-lg bg-canvas/60 text-sm ring-1 ring-white/[0.06]">
                        @foreach ($warnings as $warning)
                            <li class="px-3 py-1.5" data-filter-item><span class="text-white/80">{{ $warning['project'] }}</span><span class="muted">: {{ $warning['message'] }}</span></li>
                        @endforeach
                    </ul>
                    <p class="muted mt-2 hidden text-xs" data-filter-empty>Keine Treffer.</p>
                </details>
            @endif

            @if (count($unrouted))
                <details class="mt-2" data-filter-scope>
                    <summary class="link cursor-pointer text-sm">{{ count($unrouted) }} Projekte mit Repository, aber ohne Jira- oder ClickUp-Link</summary>
                    @if (count($unrouted) > 8)
                        <input type="search" placeholder="In diesen Projekten suchen…" aria-label="Projekte filtern" data-filter-input class="field !h-9 max-w-sm">
                    @endif
                    <ul class="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-lg bg-canvas/60 p-3 ring-1 ring-white/[0.06]">
                        @foreach ($unrouted as $project)
                            <li class="chip text-white/60" data-filter-item>{{ $project }}</li>
                        @endforeach
                    </ul>
                    <p class="muted mt-2 hidden text-xs" data-filter-empty>Keine Treffer.</p>
                </details>
            @endif
        </div>
    @endif

    {{-- toolbar: search, filters, sorting --}}
    <form method="GET" action="{{ request()->url() }}" class="mt-8 flex flex-wrap items-center gap-2" role="search">
        <input type="search" name="q" value="{{ $filters['q'] }}" placeholder="Name, GitHub, Keys, inBudget-Projekt…" aria-label="Projekte durchsuchen"
               class="h-9 w-full min-w-0 rounded-lg bg-canvas px-3 text-sm text-white ring-1 ring-white/10 outline-none ring-inset placeholder:text-white/25 focus:ring-gold/60 sm:w-72">
        <select name="source" aria-label="Quelle" onchange="this.form.submit()" class="{{ $selectClass }}">
            <option value="">Alle Quellen</option>
            <option value="inbudget" @selected($filters['source'] === 'inbudget')>inBudget ({{ $facets['source']['inbudget'] }})</option>
            <option value="manual" @selected($filters['source'] === 'manual')>Manuell ({{ $facets['source']['manual'] }})</option>
        </select>
        <select name="tracker" aria-label="Tracker" onchange="this.form.submit()" class="{{ $selectClass }}">
            <option value="">Alle Tracker</option>
            <option value="jira" @selected($filters['tracker'] === 'jira')>Jira ({{ $facets['tracker']['jira'] }})</option>
            <option value="clickup" @selected($filters['tracker'] === 'clickup')>ClickUp ({{ $facets['tracker']['clickup'] }})</option>
            <option value="other" @selected($filters['tracker'] === 'other')>Andere ({{ $facets['tracker']['other'] }})</option>
        </select>
        <select name="status" aria-label="Status" onchange="this.form.submit()" class="{{ $selectClass }}">
            <option value="">Alle Status</option>
            <option value="active" @selected($filters['status'] === 'active')>Aktiv ({{ $facets['status']['active'] }})</option>
            <option value="inactive" @selected($filters['status'] === 'inactive')>Inaktiv ({{ $facets['status']['inactive'] }})</option>
        </select>
        <select name="sort" aria-label="Sortierung" onchange="this.form.submit()" class="{{ $selectClass }}">
            @foreach (['name' => 'Name A–Z', '-name' => 'Name Z–A', 'status' => 'Aktive zuerst', 'source' => 'Manuelle zuerst'] as $value => $label)
                <option value="{{ $value }}" @selected($filters['sort'] === $value)>{{ $label }}</option>
            @endforeach
        </select>
        <select name="per_page" aria-label="Pro Seite" onchange="this.form.submit()" class="{{ $selectClass }}">
            @foreach ($perPageOptions as $option)
                <option value="{{ $option }}" @selected($filters['per_page'] === $option)>{{ $option }} pro Seite</option>
            @endforeach
        </select>
        <button class="btn-ghost">Suchen</button>
        @if ($filtered)
            <a href="{{ request()->url() }}" class="link text-sm">Zurücksetzen</a>
        @endif
    </form>

    <p class="muted mt-4 text-sm tabular-nums" data-result-count>
        @if ($repositories->total() === $total)
            {{ $total }} {{ $total === 1 ? 'Repository' : 'Repositories' }}
        @else
            {{ $repositories->total() }} von {{ $total }} Repositories
        @endif
        @if ($repositories->lastPage() > 1)
            · {{ $repositories->firstItem() }}–{{ $repositories->lastItem() }} angezeigt
        @endif
    </p>

    <div class="card divided mt-3 overflow-hidden">
        @forelse ($repositories as $repo)
            @php($name = $repo['_name'])
            @php($managed = $repo['_managed'])
            <details class="group" @if (old('_repo') === $name) open @endif>
                <summary class="card-row flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 [&::-webkit-details-marker]:hidden">
                    <div class="min-w-0 flex-1 basis-56">
                        <div class="truncate font-medium text-white">{{ $name }}</div>
                        <div class="muted mt-0.5 truncate text-xs"><span class="font-mono">{{ $repo['baseBranch'] ?? 'main' }}</span>@if (! empty($repo['teamKeys'])) · {{ implode(', ', $repo['teamKeys']) }}@endif @if (! empty($repo['projectKeys'])) · {{ implode(', ', $repo['projectKeys']) }}@endif @if (! empty($repo['_projects'])) · {{ implode(', ', $repo['_projects']) }}@endif</div>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        @if ($repo['_tracker'] !== 'other')
                            <span class="chip text-white/60">{{ ['jira' => 'Jira', 'clickup' => 'ClickUp'][$repo['_tracker']] }}</span>
                        @endif
                        @if ($managed)
                            <span class="chip text-white/70">inBudget</span>
                        @endif
                        @if ($repo['_active'])
                            <span class="chip text-gold"><span class="chip-dot"></span>aktiv</span>
                        @else
                            <span class="chip text-white/50">inaktiv</span>
                        @endif
                    </div>
                    <div class="ml-auto flex items-center gap-4">
                        @if ($repo['githubUrl'] ?? null)
                            <a href="{{ $repo['githubUrl'] }}" target="_blank" rel="noopener" class="link text-sm">GitHub</a>
                        @endif
                        <svg class="size-4 text-white/35 transition-transform duration-200 group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/></svg>
                    </div>
                </summary>
                <div class="border-t border-white/[0.06] bg-canvas/40 px-4 py-5 sm:px-5">
                    <form method="POST" action="{{ route('repositories.update', $name) }}" class="grid gap-4 sm:grid-cols-2">
                        @csrf
                        @method('PUT')
                        <input type="hidden" name="_repo" value="{{ $name }}">
                        @foreach ($listQuery as $key => $value)
                            <input type="hidden" name="_query[{{ $key }}]" value="{{ $value }}">
                        @endforeach
                        @if ($managed)
                            <p class="muted text-xs sm:col-span-2">Routing kommt aus inBudget{{ empty($repo['_projects']) ? '' : ' ('.implode(', ', $repo['_projects']).')' }}. Team-Keys und Projekte änderst du dort; Basis-Branch und aktiv bleiben hier.</p>
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
                            <input type="checkbox" name="isActive" value="1" @checked($repo['_active']) class="size-4 accent-gold"> aktiv
                        </label>
                        <div class="muted text-xs break-all sm:col-span-2">Pfad: <span class="font-mono">{{ $repo['repositoryPath'] ?? '–' }}</span></div>
                        <div class="sm:col-span-2">
                            <button class="btn">Routing speichern</button>
                        </div>
                    </form>
                    <form method="POST" action="{{ route('repositories.destroy', $name) }}" class="mt-6 flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-5"
                          onsubmit="return confirm('{{ $name }} aus nyrus entfernen?')">
                        @csrf
                        @method('DELETE')
                        @foreach ($listQuery as $key => $value)
                            <input type="hidden" name="_query[{{ $key }}]" value="{{ $value }}">
                        @endforeach
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
                @if ($total === 0)
                    <p class="font-medium text-white">Noch keine Repositories.</p>
                    <p class="muted mt-1 text-sm">Füge das erste über «Repository hinzufügen» hinzu.</p>
                @else
                    <p class="font-medium text-white">Keine Treffer.</p>
                    <p class="muted mt-1 text-sm">Kein Repository passt zu Suche und Filtern. <a href="{{ request()->url() }}" class="link">Filter zurücksetzen</a></p>
                @endif
            </div>
        @endforelse
    </div>

    <div class="mt-6">
        @include('partials.pagination', ['paginator' => $repositories])
    </div>

    {{-- add a repository by hand --}}
    <dialog id="add-repository" aria-labelledby="add-repository-title" @if ($openAdd) open data-dialog-autoopen @endif
            class="m-auto w-[min(40rem,calc(100%-2rem))] max-w-none rounded-xl bg-surface p-0 text-white/80 ring-1 ring-white/10 backdrop:bg-black/70 backdrop:backdrop-blur-sm">
        <div class="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:p-6">
            <div class="flex items-start gap-4">
                <div class="min-w-0">
                    <h2 id="add-repository-title" class="text-lg">Repository hinzufügen</h2>
                    <p class="muted mt-1 text-sm">nyrus klont das Repository auf dem Server (über <span class="font-mono">gh</span>, der Bot-Account braucht Zugriff). Das kann einen Moment dauern.</p>
                </div>
                <form method="dialog" class="ml-auto">
                    <button class="btn-ghost !h-8 !px-2" aria-label="Schliessen">
                        <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/></svg>
                    </button>
                </form>
            </div>

            @if (old('_form') === 'add' && session('error'))
                <div class="notice mt-5 !bg-canvas">
                    <span class="notice-dot text-danger" aria-hidden="true"></span>
                    <span>{{ session('error') }}</span>
                </div>
            @endif

            <form method="POST" action="{{ route('repositories.store') }}" class="mt-6 grid gap-4 sm:grid-cols-2" data-busy-form>
                @csrf
                <input type="hidden" name="_form" value="add">
                @foreach (\Illuminate\Support\Arr::except($listQuery, ['add']) as $key => $value)
                    <input type="hidden" name="_query[{{ $key }}]" value="{{ $value }}">
                @endforeach
                <label class="label sm:col-span-2">Git-URL
                    <input name="repository_url" value="{{ old('repository_url') }}" required placeholder="https://github.com/teamnovu/projekt.git" class="field font-mono" autofocus>
                    @if (old('_form') === 'add')
                        @error('repository_url') <span class="mt-1 block text-danger">{{ $message }}</span> @enderror
                    @endif
                </label>
                <label class="label">Name (optional, sonst aus der URL)
                    <input name="name" value="{{ old('name') }}" class="field">
                    @if (old('_form') === 'add')
                        @error('name') <span class="mt-1 block text-danger">{{ $message }}</span> @enderror
                    @endif
                </label>
                <label class="label">Basis-Branch
                    <input name="baseBranch" value="{{ old('_form') === 'add' ? old('baseBranch', 'main') : 'main' }}" class="field font-mono">
                </label>
                <label class="label">Projekte (kommagetrennt)
                    <input name="projectKeys" value="{{ old('_form') === 'add' ? old('projectKeys') : '' }}" class="field">
                </label>
                <label class="label">Team-Keys (kommagetrennt)
                    <input name="teamKeys" value="{{ old('_form') === 'add' ? old('teamKeys') : '' }}" class="field">
                </label>
                <label class="label sm:col-span-2">Routing-Labels (kommagetrennt)
                    <input name="routingLabels" value="{{ old('_form') === 'add' ? old('routingLabels') : '' }}" class="field">
                </label>
                <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
                    <button class="btn" data-busy-label="Klone…">Hinzufügen</button>
                    <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                </div>
            </form>
        </div>
    </dialog>
</x-app>
