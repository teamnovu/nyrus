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
    <p class="muted mt-2 text-sm">Ein Eintrag pro GitHub-Repository: woher nyrus Tickets dafür bekommt (Jira, ClickUp, GitHub Issues). Klicke ein Repository an, um fehlende Angaben zu ergänzen.@if ($grouping) Repositories einer Gruppe (standardmässig pro inBudget-Kunde) stehen zusammen: Tickets für ein Repo der Gruppe bekommen alle Repos der Gruppe.@endif</p>

    @if ($error)
        <div class="notice mt-6">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>Konfiguration konnte nicht geladen werden: {{ $error }}</span>
        </div>
    @endif

    @if ($inbudget)
        @php($result = $inbudget['result'] ?? [])
        @php($hints = count($result['errors'] ?? []) + count($inbudget['warnings'] ?? []) + (isset($inbudget['repos']) ? 0 : count($inbudget['unrouted'] ?? [])))
        <div class="card mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 p-4 sm:px-5" data-inbudget-card>
            <div class="min-w-0 flex-1 basis-64">
                <h2 class="text-base">inBudget <span class="muted text-sm font-normal">ist die Hauptquelle</span></h2>
                <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    @if ($inbudget['running'] ?? false)
                        <span class="text-gold">Abgleich läuft…</span>
                    @endif
                    @if ($inbudget['lastSuccessAt'] ?? null)
                        <span class="muted">Zuletzt {{ \Illuminate\Support\Carbon::parse($inbudget['lastSuccessAt'])->timezone(config('app.timezone'))->format('d.m.Y H:i') }}</span>
                        <span class="muted">{{ $inbudget['projectCount'] ?? 0 }} aktive Projekte</span>
                        <span class="muted">{{ count($inbudget['repos'] ?? $inbudget['repositories'] ?? []) }} Repositories</span>
                    @elseif (! ($inbudget['running'] ?? false) && ! ($inbudget['error'] ?? null))
                        <span class="muted">Noch nicht abgeglichen.</span>
                    @endif
                    @foreach (['added' => 'neu', 'updated' => 'geändert', 'reactivated' => 'wieder aktiv', 'deactivated' => 'deaktiviert'] as $key => $label)
                        @if (! empty($result[$key]))
                            <span class="text-white/80">{{ count($result[$key]) }} {{ $label }}</span>
                        @endif
                    @endforeach
                    <a href="{{ route('repositories.inbudget', $listQuery) }}" @class(['link', '!text-warning' => count($result['errors'] ?? [])])>{{ $hints ? $hints.' '.($hints === 1 ? 'Hinweis' : 'Hinweise') : 'Details' }} zum Abgleich</a>
                </div>
            </div>
            <form method="POST" action="{{ route('repositories.inbudget-sync') }}" data-busy-form>
                @csrf
                @foreach ($listQuery as $key => $value)
                    <input type="hidden" name="_query[{{ $key }}]" value="{{ $value }}">
                @endforeach
                <button class="btn-ghost" data-busy-label="Gleiche ab…" @disabled($inbudget['running'] ?? false)>Jetzt abgleichen</button>
            </form>
            @if ($inbudget['error'] ?? null)
                <div class="notice basis-full !bg-canvas">
                    <span class="notice-dot text-warning" aria-hidden="true"></span>
                    <span>Letzter Abgleich fehlgeschlagen: {{ $inbudget['error'] }}</span>
                </div>
            @elseif (($inbudget['infoCount'] ?? null) === 0 && ! ($inbudget['resourceRepoCount'] ?? null) && ($inbudget['lastSuccessAt'] ?? null) && ! ($inbudget['running'] ?? false))
                <div class="notice basis-full !bg-canvas" data-inbudget-no-infos>
                    <span class="notice-dot text-warning" aria-hidden="true"></span>
                    <span>inBudget hat weder Projekt-Infos noch Repositories von Kunden-Ressourcen geliefert – sieht der Token-User sie?</span>
                </div>
            @endif
        </div>
    @endif

    {{-- toolbar: search, filters, sorting --}}
    <form method="GET" action="{{ request()->url() }}" class="mt-8 flex flex-wrap items-center gap-2" role="search">
        <input type="search" name="q" value="{{ $filters['q'] }}" placeholder="Repository, Kunde, Jira-Projekt, Liste…" aria-label="Projekte durchsuchen"
               class="h-9 w-full min-w-0 rounded-lg bg-canvas px-3 text-sm text-white ring-1 ring-white/10 outline-none ring-inset placeholder:text-white/25 focus:ring-gold/60 sm:w-72">
        <select name="tracker" aria-label="Tracker" onchange="this.form.submit()" class="{{ $selectClass }}">
            <option value="">Alle Tracker</option>
            <option value="none" @selected($filters['tracker'] === 'none')>Ohne Jira/ClickUp ({{ $facets['tracker']['none'] }})</option>
            <option value="jira" @selected($filters['tracker'] === 'jira')>Mit Jira ({{ $facets['tracker']['jira'] }})</option>
            <option value="clickup" @selected($filters['tracker'] === 'clickup')>Mit ClickUp ({{ $facets['tracker']['clickup'] }})</option>
            <option value="github" @selected($filters['tracker'] === 'github')>Mit GitHub Issues ({{ $facets['tracker']['github'] }})</option>
        </select>
        <select name="source" aria-label="Quelle" onchange="this.form.submit()" class="{{ $selectClass }}">
            <option value="">Alle Quellen</option>
            <option value="inbudget" @selected($filters['source'] === 'inbudget')>Aus inBudget ({{ $facets['source']['inbudget'] }})</option>
            <option value="manual" @selected($filters['source'] === 'manual')>Manuell angelegt ({{ $facets['source']['manual'] }})</option>
        </select>
        <select name="status" aria-label="Status" onchange="this.form.submit()" class="{{ $selectClass }}">
            <option value="">Alle Status</option>
            <option value="active" @selected($filters['status'] === 'active')>Aktiv ({{ $facets['status']['active'] }})</option>
            <option value="inactive" @selected($filters['status'] === 'inactive')>Inaktiv ({{ $facets['status']['inactive'] }})</option>
        </select>
        @if ($grouping)
            <select name="group" aria-label="Gruppen" onchange="this.form.submit()" class="{{ $selectClass }}">
                <option value="">Alle Gruppen</option>
                <option value="multi" @selected($filters['group'] === 'multi')>Gruppen mit mehreren Repos ({{ $facets['group']['multi'] }})</option>
                <option value="single" @selected($filters['group'] === 'single')>Einzelne Repos ({{ $facets['group']['single'] }})</option>
            </select>
        @endif
        <select name="sort" aria-label="Sortierung" onchange="this.form.submit()" class="{{ $selectClass }}">
            @foreach (['name' => 'Name A–Z', '-name' => 'Name Z–A', 'missing' => 'Ohne Tracker zuerst', 'status' => 'Aktive zuerst', 'source' => 'Manuelle zuerst'] + ($grouping ? ['group' => 'Grösste Gruppen zuerst'] : []) as $value => $label)
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
        @if ($matchCount === $total)
            {{ $total }} {{ $total === 1 ? 'Repository' : 'Repositories' }}
        @else
            {{ $matchCount }} von {{ $total }} Repositories
        @endif
        @if ($units->lastPage() > 1)
            · {{ $shownFrom }}–{{ $shownTo }} angezeigt
        @endif
    </p>

    <div class="card divided mt-3 overflow-hidden">
        @forelse ($units as $unit)
            @php($group = $unit['group'])
            @php($inGroup = $group && $group['size'] > 1)
            @if ($inGroup)
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-white/[0.02] px-4 py-2.5 sm:px-5" data-group-header="{{ $group['key'] }}">
                    <svg class="size-4 shrink-0 text-gold/70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75ZM3.75 9A1.75 1.75 0 0 0 2 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-4.5A1.75 1.75 0 0 0 16.25 9H3.75Z"/></svg>
                    <span class="font-medium text-white" data-group-name>{{ $group['name'] }}</span>
                    @include('partials.group-chips', ['group' => $group])
                    <span class="muted text-xs tabular-nums">{{ $group['size'] }} Repos{{ count($unit['rows']) < $group['size'] ? ' · '.count($unit['rows']).' passen' : '' }}</span>
                    <a href="{{ route('repositories.group', ['key' => $group['key']] + $listQuery) }}" class="link ml-auto text-sm">Gruppe bearbeiten</a>
                </div>
            @endif
            @foreach ($unit['rows'] as $row)
                @php([$owner, $repo] = explode('/', $row['key'], 2))
                <a href="{{ route('repositories.show', ['owner' => $owner, 'repo' => $repo] + $listQuery) }}"
                   @class(['card-row flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5', 'sm:pl-12' => $inGroup]) data-repo-row="{{ $row['key'] }}">
                    <div class="min-w-0 flex-1 basis-56">
                        <div class="truncate"><span class="font-medium text-white" data-repo-name>{{ $row['name'] }}</span>@if ($row['owner']) <span class="muted text-sm">{{ $row['owner'] }}</span>@endif</div>
                        <div class="muted mt-0.5 truncate text-xs">
                            @if ($row['projects'])
                                {{ implode(' · ', $row['projects']) }}
                            @elseif (! $row['inbudget'])
                                Nicht in inBudget
                            @else
                                Kein aktives inBudget-Projekt
                            @endif
                            @if ($row['branches'])
                                · <span class="font-mono">{{ $row['branches'][0] }}</span>{{ count($row['branches']) > 1 ? ' +'.(count($row['branches']) - 1) : '' }}
                            @endif
                        </div>
                    </div>
                    @include('partials.project-chips', ['row' => $row])
                    <svg class="ml-auto size-4 shrink-0 text-white/35" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/></svg>
                </a>
            @endforeach
        @empty
            <div class="px-5 py-12 text-center">
                @if ($total === 0)
                    <p class="font-medium text-white">Noch keine Repositories.</p>
                    <p class="muted mt-1 text-sm">Gleiche mit inBudget ab oder füge eines über «Repository hinzufügen» hinzu.</p>
                @else
                    <p class="font-medium text-white">Keine Treffer.</p>
                    <p class="muted mt-1 text-sm">Kein Repository passt zu Suche und Filtern. <a href="{{ request()->url() }}" class="link">Filter zurücksetzen</a></p>
                @endif
            </div>
        @endforelse
    </div>

    <div class="mt-6">
        @include('partials.pagination', ['paginator' => $units])
    </div>

    {{-- add a repository by hand --}}
    <dialog id="add-repository" aria-labelledby="add-repository-title" @if ($openAdd) open data-dialog-autoopen @endif
            class="m-auto w-[min(40rem,calc(100%-2rem))] max-w-none rounded-xl bg-surface p-0 text-white/80 ring-1 ring-white/10 backdrop:bg-black/70 backdrop:backdrop-blur-sm">
        @php($fromForm = old('_form') === 'add')
        <div class="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:p-6">
            <div class="flex items-start gap-4">
                <div class="min-w-0">
                    <h2 id="add-repository-title" class="text-lg">Repository hinzufügen</h2>
                    <p class="muted mt-1 text-sm">Für Repositories, die nicht über inBudget kommen. nyrus klont es auf dem Server (über <span class="font-mono">gh</span>, der Bot-Account braucht Zugriff). Das kann einen Moment dauern.</p>
                </div>
                <form method="dialog" class="ml-auto">
                    <button class="btn-ghost !h-8 !px-2" aria-label="Schliessen">
                        <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/></svg>
                    </button>
                </form>
            </div>

            @if ($fromForm && session('error'))
                <div class="notice mt-5 !bg-canvas">
                    <span class="notice-dot text-danger" aria-hidden="true"></span>
                    <span>{{ session('error') }}</span>
                </div>
            @endif

            <form method="POST" action="{{ route('repositories.store') }}" class="mt-6 grid gap-4 sm:grid-cols-2" data-busy-form>
                @csrf
                <input type="hidden" name="_form" value="add">
                @foreach ($listQuery as $key => $value)
                    <input type="hidden" name="_query[{{ $key }}]" value="{{ $value }}">
                @endforeach
                <label class="label sm:col-span-2">Git-URL
                    <input name="repository_url" value="{{ old('repository_url', request()->query('repository_url')) }}" required placeholder="https://github.com/teamnovu/projekt.git" class="field font-mono" autofocus>
                    @if ($fromForm)
                        @error('repository_url') <span class="mt-1 block text-danger">{{ $message }}</span> @enderror
                    @endif
                </label>
                <label class="label">Name (optional, sonst aus der URL)
                    <input name="name" value="{{ old('name') }}" class="field">
                    @if ($fromForm)
                        @error('name') <span class="mt-1 block text-danger">{{ $message }}</span> @enderror
                    @endif
                </label>
                <label class="label">Basis-Branch
                    <input name="baseBranch" value="{{ $fromForm ? old('baseBranch', 'main') : 'main' }}" class="field font-mono">
                </label>
                <label class="label sm:col-span-2">Tracker (Workspace)
                    <input name="linearWorkspaceId" list="tracker-workspaces" value="{{ $fromForm ? old('linearWorkspaceId') : ($workspaces[0] ?? '') }}" placeholder="z.B. jira-novu, clickup-123 oder github" class="field font-mono">
                    <datalist id="tracker-workspaces">
                        @foreach ($workspaces as $workspace)
                            <option value="{{ $workspace }}"></option>
                        @endforeach
                    </datalist>
                    <span class="muted mt-1 block text-xs">Woher die Tickets kommen. Mit <span class="font-mono">github</span> nimmt nyrus die Issues im Repository selbst an.</span>
                    @if ($fromForm)
                        @error('linearWorkspaceId') <span class="mt-1 block text-danger">{{ $message }}</span> @enderror
                    @endif
                </label>
                <label class="label">Jira-Projekt oder ClickUp-Space (kommagetrennt)
                    <input name="teamKeys" value="{{ $fromForm ? old('teamKeys') : '' }}" placeholder="z.B. SAY" class="field">
                </label>
                <label class="label">ClickUp-Liste (kommagetrennt)
                    <input name="projectKeys" value="{{ $fromForm ? old('projectKeys') : '' }}" class="field">
                </label>
                <label class="label sm:col-span-2">Routing-Labels (erweitert, kommagetrennt)
                    <input name="routingLabels" value="{{ $fromForm ? old('routingLabels') : '' }}" class="field">
                    <span class="muted mt-1 block text-xs">Nur nötig, wenn mehrere Repositories dasselbe Projekt teilen: Tickets mit diesem Label gehen hierher.</span>
                </label>
                <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
                    <button class="btn" data-busy-label="Klone…">Hinzufügen</button>
                    <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                </div>
            </form>
        </div>
    </dialog>
</x-app>
