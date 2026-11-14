<x-app title="Projekte">
    @php($openAdd = request()->boolean('add') || old('_form') === 'add')
    @php($fmtDate = fn ($iso) => \Illuminate\Support\Carbon::parse($iso)->timezone(config('app.timezone'))->format('d.m.Y H:i'))

    <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-0">
            <p class="eyebrow">Konfiguration</p>
            <h1 class="page-title">Projekte</h1>
        </div>
        <a href="{{ request()->fullUrlWithQuery(['add' => 1]) }}" class="btn ml-auto" data-dialog-open="add-repository">
            <x-icon name="plus" />
            Repository hinzufügen
        </a>
    </div>
    <p class="page-lead">Ein Eintrag pro GitHub-Repository: woher nyrus Tickets dafür bekommt (Jira, ClickUp, GitHub Issues). Klicke ein Repository an, um fehlende Angaben zu ergänzen.@if ($grouping) Repositories einer Gruppe (standardmässig pro inBudget-Kunde) stehen zusammen: Tickets für ein Repo der Gruppe bekommen alle Repos der Gruppe.@endif</p>

    @if ($error)
        <div class="notice mt-6 border-warning/30">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>Konfiguration konnte nicht geladen werden: {{ $error }}</span>
        </div>
    @endif

    @if ($inbudget)
        @php($result = $inbudget['result'] ?? [])
        @php($hints = count($result['errors'] ?? []) + count($inbudget['warnings'] ?? []) + (isset($inbudget['repos']) ? 0 : count($inbudget['unrouted'] ?? [])))
        <div class="card mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 p-4 sm:px-5" data-inbudget-card>
            <div class="flex min-w-0 flex-1 basis-72 items-start gap-3.5">
                <span class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold"><x-icon name="refresh" /></span>
                <div class="min-w-0">
                    <h2 class="flex flex-wrap items-center gap-2 text-base">inBudget <span class="text-sm font-normal text-white/50">ist die Hauptquelle</span>
                        @if ($inbudget['running'] ?? false)
                            <span class="chip chip-status text-info"><span class="chip-dot" data-ping></span>Abgleich läuft…</span>
                        @endif
                    </h2>
                    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/55">
                        @if ($inbudget['lastSuccessAt'] ?? null)
                            <span>Zuletzt <span class="text-white/85">{{ $fmtDate($inbudget['lastSuccessAt']) }}</span></span>
                            @if ($inbudget['lastFullSyncAt'] ?? null)
                                <span title="Änderungen werden alle 30 Minuten geholt, alles einmal täglich und mit «Jetzt abgleichen».">vollständig <span class="text-white/85">{{ $fmtDate($inbudget['lastFullSyncAt']) }}</span></span>
                            @endif
                            <span class="tabular-nums">{{ $inbudget['projectCount'] ?? 0 }} aktive Projekte</span>
                            <span class="tabular-nums">{{ count($inbudget['repos'] ?? $inbudget['repositories'] ?? []) }} Repositories</span>
                        @elseif (! ($inbudget['running'] ?? false) && ! ($inbudget['error'] ?? null))
                            <span>Noch nicht abgeglichen.</span>
                        @endif
                        @foreach (['added' => 'neu', 'updated' => 'geändert', 'reactivated' => 'wieder aktiv', 'deactivated' => 'deaktiviert'] as $key => $label)
                            @if (! empty($result[$key]))
                                <span class="text-success">{{ count($result[$key]) }} {{ $label }}</span>
                            @endif
                        @endforeach
                    </div>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <a href="{{ route('repositories.inbudget', $listQuery) }}" @class(['btn-ghost', '!border-warning/40 !bg-warning/10 !text-warning' => $hints > 0])>
                    @if ($hints)<x-icon name="warning" class="size-4" />@endif{{ $hints ? $hints.' '.($hints === 1 ? 'Hinweis' : 'Hinweise') : 'Details' }} zum Abgleich
                </a>
                <form method="POST" action="{{ route('repositories.inbudget-sync') }}" data-busy-form>
                    @csrf
                    @foreach ($listQuery as $key => $value)
                        <input type="hidden" name="_query[{{ $key }}]" value="{{ $value }}">
                    @endforeach
                    <button class="btn-ghost" data-busy-label="Gleiche ab…" @disabled($inbudget['running'] ?? false)><x-icon name="refresh" class="size-4 text-white/60" />Jetzt abgleichen</button>
                </form>
            </div>
            @if ($inbudget['error'] ?? null)
                <div class="notice basis-full border-warning/30 !bg-inset">
                    <span class="notice-dot text-warning" aria-hidden="true"></span>
                    <span>Letzter Abgleich fehlgeschlagen: {{ $inbudget['error'] }}</span>
                </div>
            @elseif (($inbudget['infoCount'] ?? null) === 0 && ! ($inbudget['resourceRepoCount'] ?? null) && ($inbudget['lastSuccessAt'] ?? null) && ! ($inbudget['running'] ?? false))
                <div class="notice basis-full border-warning/30 !bg-inset" data-inbudget-no-infos>
                    <span class="notice-dot text-warning" aria-hidden="true"></span>
                    <span>inBudget hat weder Projekt-Infos noch Repositories von Kunden-Ressourcen geliefert – sieht der Token-User sie?</span>
                </div>
            @endif
        </div>
    @endif

    {{-- toolbar: search, filters, sorting; stays on top while scrolling --}}
    <div class="sticky-bar mt-8 max-sm:static" data-sticky>
        <form method="GET" action="{{ request()->url() }}" class="flex flex-wrap items-center gap-2 py-3" role="search">
            <label class="search w-full sm:w-auto sm:min-w-56 sm:flex-1">
                <x-icon name="search" />
                <input type="search" name="q" value="{{ $filters['q'] }}" placeholder="Repository, Kunde, Jira-Projekt, Liste…" aria-label="Projekte durchsuchen" class="input" data-hotkey-search>
                <span class="kbd">/</span>
            </label>
            <select name="tracker" aria-label="Tracker" onchange="this.form.submit()" class="select max-w-44" @if ($filters['tracker']) data-active @endif>
                <option value="">Alle Tracker</option>
                <option value="none" @selected($filters['tracker'] === 'none')>Ohne Jira/ClickUp ({{ $facets['tracker']['none'] }})</option>
                <option value="jira" @selected($filters['tracker'] === 'jira')>Mit Jira ({{ $facets['tracker']['jira'] }})</option>
                <option value="clickup" @selected($filters['tracker'] === 'clickup')>Mit ClickUp ({{ $facets['tracker']['clickup'] }})</option>
                <option value="github" @selected($filters['tracker'] === 'github')>Mit GitHub Issues ({{ $facets['tracker']['github'] }})</option>
            </select>
            <select name="source" aria-label="Quelle" onchange="this.form.submit()" class="select max-w-44" @if ($filters['source']) data-active @endif>
                <option value="">Alle Quellen</option>
                <option value="inbudget" @selected($filters['source'] === 'inbudget')>Aus inBudget ({{ $facets['source']['inbudget'] }})</option>
                <option value="manual" @selected($filters['source'] === 'manual')>Manuell angelegt ({{ $facets['source']['manual'] }})</option>
            </select>
            <select name="status" aria-label="Status" onchange="this.form.submit()" class="select max-w-44" @if ($filters['status']) data-active @endif>
                <option value="">Alle Status</option>
                <option value="active" @selected($filters['status'] === 'active')>Aktiv ({{ $facets['status']['active'] }})</option>
                <option value="inactive" @selected($filters['status'] === 'inactive')>Inaktiv ({{ $facets['status']['inactive'] }})</option>
            </select>
            @if ($grouping)
                <select name="group" aria-label="Gruppen" onchange="this.form.submit()" class="select max-w-44" @if ($filters['group']) data-active @endif>
                    <option value="">Alle Gruppen</option>
                    <option value="multi" @selected($filters['group'] === 'multi')>Gruppen mit mehreren Repos ({{ $facets['group']['multi'] }})</option>
                    <option value="single" @selected($filters['group'] === 'single')>Einzelne Repos ({{ $facets['group']['single'] }})</option>
                </select>
            @endif
            <select name="sort" aria-label="Sortierung" onchange="this.form.submit()" class="select max-w-48">
                @foreach (['name' => 'Name A–Z', '-name' => 'Name Z–A', 'missing' => 'Ohne Tracker zuerst', 'status' => 'Aktive zuerst', 'source' => 'Manuelle zuerst'] + ($grouping ? ['group' => 'Grösste Gruppen zuerst'] : []) as $value => $label)
                    <option value="{{ $value }}" @selected($filters['sort'] === $value)>{{ $label }}</option>
                @endforeach
            </select>
            <input type="hidden" name="per_page" value="{{ $filters['per_page'] }}">
            <button class="btn-ghost">Suchen</button>
            @if ($filtered)
                <a href="{{ request()->url() }}" class="btn-ghost !px-2.5" title="Filter zurücksetzen"><x-icon name="x" class="size-4 text-white/60" />Zurücksetzen</a>
            @endif
        </form>
    </div>

    <p class="muted mt-3 text-sm tabular-nums" data-result-count>
        @if ($matchCount === $total)
            {{ $total }} {{ $total === 1 ? 'Repository' : 'Repositories' }}
        @else
            {{ $matchCount }} von {{ $total }} Repositories
        @endif
        @if ($units->lastPage() > 1)
            · {{ $shownFrom }}–{{ $shownTo }} angezeigt
        @endif
    </p>

    {{-- overflow-clip (not hidden) so the group headers can stick --}}
    <div class="card mt-3 overflow-clip">
        @forelse ($units as $unit)
            @php($group = $unit['group'])
            @php($inGroup = $group && $group['size'] > 1)
            {{-- one block per unit, so a group's header only sticks while its repositories pass --}}
            <div class="border-t border-line first:border-t-0">
            @if ($inGroup)
                <div class="sticky top-[var(--sticky-offset,7.5rem)] z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-raised/95 px-4 py-2.5 backdrop-blur sm:px-5" data-group-header="{{ $group['key'] }}">
                    <x-icon name="folder" class="size-4 text-gold/80" />
                    <span class="font-medium text-white" data-group-name>{{ $group['name'] }}</span>
                    @include('partials.group-chips', ['group' => $group])
                    @include('partials.group-trackers', ['group' => $group])
                    <span class="text-xs text-white/50 tabular-nums">{{ $group['size'] }} Repos{{ count($unit['rows']) < $group['size'] ? ' · '.count($unit['rows']).' passen' : '' }}</span>
                    <a href="{{ route('repositories.group', ['key' => $group['key']] + $listQuery) }}" class="link ml-auto inline-flex items-center gap-1 text-sm"><x-icon name="pencil" class="size-3.5" />Gruppe bearbeiten</a>
                </div>
            @endif
            @foreach ($unit['rows'] as $row)
                @php([$owner, $repo] = explode('/', $row['key'], 2))
                <a href="{{ route('repositories.show', ['owner' => $owner, 'repo' => $repo] + $listQuery) }}"
                   @class(['card-row group relative flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3.5 first:border-t-0 sm:px-5', 'sm:pl-12' => $inGroup]) data-repo-row="{{ $row['key'] }}">
                    @if ($inGroup)
                        <span class="absolute inset-y-0 left-[1.6rem] hidden w-px bg-line-strong sm:block" aria-hidden="true"></span>
                    @endif
                    <div class="min-w-0 flex-1 basis-56">
                        <div class="truncate"><span class="font-medium text-white" data-repo-name>{{ $row['name'] }}</span>@if ($row['owner']) <span class="text-sm text-white/45">{{ $row['owner'] }}</span>@endif</div>
                        <div class="mt-0.5 truncate text-xs text-white/50">
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
                    <x-icon name="chevron-right" class="ml-auto hidden size-4 text-white/30 transition sm:block group-hover:translate-x-0.5 group-hover:text-white/70" />
                </a>
            @endforeach
            </div>
        @empty
            <div class="flex flex-col items-center px-5 py-14 text-center">
                <x-icon name="folder" class="size-8 text-white/20" />
                @if ($total === 0)
                    <p class="mt-3 font-medium text-white">Noch keine Repositories.</p>
                    <p class="muted mt-1 text-sm">Gleiche mit inBudget ab oder füge eines über «Repository hinzufügen» hinzu.</p>
                @else
                    <p class="mt-3 font-medium text-white">Keine Treffer.</p>
                    <p class="muted mt-1 text-sm">Kein Repository passt zu Suche und Filtern. <a href="{{ request()->url() }}" class="link">Filter zurücksetzen</a></p>
                @endif
            </div>
        @endforelse
    </div>

    <div class="mt-6 flex flex-wrap items-center gap-4">
        <div class="min-w-0 flex-1">
            @include('partials.pagination', ['paginator' => $units])
        </div>
        <form method="GET" action="{{ request()->url() }}" class="ml-auto flex items-center gap-2 text-sm text-white/55">
            @foreach (collect($filters)->except(['per_page'])->filter(fn ($v) => $v !== null && $v !== '') as $key => $value)
                <input type="hidden" name="{{ $key }}" value="{{ $value }}">
            @endforeach
            <label for="per-page">Pro Seite</label>
            <select id="per-page" name="per_page" onchange="this.form.submit()" class="select">
                @foreach ($perPageOptions as $option)
                    <option value="{{ $option }}" @selected($filters['per_page'] === $option)>{{ $option }}</option>
                @endforeach
            </select>
            <noscript><button class="btn-ghost">OK</button></noscript>
        </form>
    </div>

    {{-- add a repository by hand --}}
    <dialog id="add-repository" aria-labelledby="add-repository-title" @if ($openAdd) open data-dialog-autoopen @endif
            class="m-auto w-[min(40rem,calc(100%-2rem))] max-w-none rounded-2xl border border-line-strong bg-surface p-0 text-white/80 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] backdrop:bg-black/70 backdrop:backdrop-blur-sm">
        @php($fromForm = old('_form') === 'add')
        <div class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div class="sticky top-0 z-10 flex items-start gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur sm:px-6">
                <div class="min-w-0">
                    <h2 id="add-repository-title" class="text-lg">Repository hinzufügen</h2>
                    <p class="muted mt-1 text-sm">Für Repositories, die nicht über inBudget kommen. nyrus klont es auf dem Server (über <span class="font-mono">gh</span>, der Bot-Account braucht Zugriff). Das kann einen Moment dauern.</p>
                </div>
                <form method="dialog" class="ml-auto">
                    <button class="btn-icon" aria-label="Schliessen"><x-icon name="x" /></button>
                </form>
            </div>

            <div class="p-5 sm:p-6">
                @if ($fromForm && session('error'))
                    <div class="notice mb-5 border-danger/30 !bg-inset">
                        <span class="notice-dot text-danger" aria-hidden="true"></span>
                        <span>{{ session('error') }}</span>
                    </div>
                @endif

                <form method="POST" action="{{ route('repositories.store') }}" class="grid gap-4 sm:grid-cols-2" data-busy-form>
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
                        <span class="muted mt-1 block text-xs font-normal">Woher die Tickets kommen. Mit <span class="font-mono">github</span> nimmt nyrus die Issues im Repository selbst an.</span>
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
                        <span class="muted mt-1 block text-xs font-normal">Nur nötig, wenn mehrere Repositories dasselbe Projekt teilen: Tickets mit diesem Label gehen hierher.</span>
                    </label>
                    <div class="flex flex-wrap items-center gap-3 border-t border-line pt-4 sm:col-span-2">
                        <button class="btn" data-busy-label="Klone…">Hinzufügen</button>
                        <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                    </div>
                </form>
            </div>
        </div>
    </dialog>
</x-app>
