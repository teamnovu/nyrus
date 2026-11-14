<x-app :title="$row['name'] ?? 'Projekt'">
    @if ($error)
        <a href="{{ route('repositories.index', $listQuery) }}" class="back-link" data-back-link><x-icon name="chevron-left" />Alle Projekte</a>
        <div class="notice mt-6">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>Konfiguration konnte nicht geladen werden: {{ $error }}</span>
        </div>
    @else
        @php
            $repoName = $row['isRepo'] ? $row['owner'].'/'.$row['name'] : null;
            $hiddenQuery = collect($listQuery)->map(fn ($v, $k) => '<input type="hidden" name="_query['.e($k).']" value="'.e($v).'">')->implode('');
            $fieldsFor = [
                'jira' => ['teamKeys' => ['Jira-Projekt', 'Key, z.B. SAY. Mehrere kommagetrennt.']],
                'clickup' => ['teamKeys' => ['ClickUp-Space', 'ID des Space (Zahl in der ClickUp-URL).'], 'projectKeys' => ['ClickUp-Liste', 'Name der Liste. Mehrere kommagetrennt.']],
                'github' => ['teamKeys' => ['GitHub-Repository', 'owner/name, dessen Issues hierher gehen.']],
                'other' => ['teamKeys' => ['Team-Keys', 'Kommagetrennt.'], 'projectKeys' => ['Projekte', 'Kommagetrennt.']],
            ];
            $sourceLabels = [
                'inbudget' => ['über inBudget', 'text-gold-light', 'Wert kommt aus inBudget'],
                'supplement' => ['manuell', 'text-white/60', 'inBudget hat keinen Wert, deiner gilt'],
                'detached' => ['entknüpft (manuell)', 'text-warning', 'Von inBudget entknüpft: dein Wert gilt, auch wenn inBudget einen hat'],
                'manual' => ['manuell', 'text-white/60', 'Eigener Eintrag in nyrus'],
            ];
            $entryDialog = fn (array $entry) => 'entry-'.\Illuminate\Support\Str::slug($entry['_id']);
            $hasKeys = fn (?array $keys) => $keys && ($keys['teamKeys'] || $keys['projectKeys']);
            $joined = fn (?array $keys, string $field) => implode(', ', $keys[$field] ?? []);
            $modals = [];
            // the group page manages Jira/ClickUp for all repos of the group (newer nyrus only)
            $groupUrl = $group && is_array($group['platforms'] ?? null) ? route('repositories.group', ['key' => $group['key']] + $listQuery) : null;
        @endphp

        {{-- back link and GitHub stay on top; the name joins them once scrolled past --}}
        <div class="sticky-bar -mt-3" data-sticky>
            <div class="flex h-12 items-center gap-3">
                <a href="{{ route('repositories.index', $listQuery) }}" class="back-link shrink-0" data-back-link><x-icon name="chevron-left" />Alle Projekte</a>
                <div class="sticky-title flex items-center gap-2 border-l border-line pl-3 text-sm" aria-hidden="true">
                    <span class="truncate">{{ $row['name'] }}</span>
                </div>
                @if ($row['githubUrl'])
                    <a href="{{ $row['githubUrl'] }}" target="_blank" rel="noopener" class="btn-ghost ml-auto !h-8 shrink-0" data-github-link><span class="mark mark-github"></span>GitHub<x-icon name="external" class="size-3.5 text-white/40" /></a>
                @endif
            </div>
        </div>

        {{-- header --}}
        <div class="mt-4 min-w-0">
            <p class="eyebrow">Projekt</p>
            <h1 class="page-title break-words">{{ $row['name'] }}@if ($row['owner']) <span class="text-xl font-normal text-white/40 sm:text-2xl">{{ $row['owner'] }}</span>@endif</h1>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2 text-sm" data-header>
            @if (! $row['hasEntries'])
                <span class="chip chip-status text-white/45"><span class="chip-dot opacity-60"></span>nicht eingerichtet</span>
            @elseif ($row['active'])
                <span class="chip chip-status text-success"><span class="chip-dot"></span>aktiv</span>
            @else
                <span class="chip chip-status text-white/55"><span class="chip-dot"></span>inaktiv</span>
            @endif
            <span @class(['chip chip-meta', 'text-gold-light' => $row['inbudget'], 'text-white/60' => ! $row['inbudget']])>{{ $row['inbudget'] ? 'inBudget' : 'nicht in inBudget' }}</span>
            @if ($group && $group['size'] > 1)
                <a href="{{ route('repositories.group', ['key' => $group['key']] + $listQuery) }}" class="chip chip-tag hover:border-white/30 hover:text-white" data-header-group><x-icon name="folder" class="size-3.5 text-gold/80" />Gruppe {{ $group['name'] }} · {{ $group['size'] }}</a>
            @endif
        </div>
        @if ($row['projects'])
            <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/60" title="inBudget-Projekte">
                @foreach ($row['projects'] as $project)
                    <li class="flex min-w-0 items-center gap-1.5"><x-icon name="document" class="size-3.5 text-white/30" /><span class="truncate">{{ $project }}</span></li>
                @endforeach
            </ul>
        @endif

        {{-- connections --}}
        <h2 class="section-title mt-10">Verbindungen</h2>
        <div class="mt-4 grid gap-4 md:grid-cols-3">
            @forelse ($row['trackers'] as $platform => $tracker)
                @php($links = \App\Services\ProjectOverview::links($tracker, $repoName, $trackerLinks))
                @php($source = $tracker['covered'] ? $tracker['source'] : null)
                <section @class(['card relative flex flex-col overflow-hidden', 'border-success/25' => $tracker['covered']]) data-tracker="{{ $platform }}">
                    <div class="flex items-center gap-3 border-b border-line px-4 py-3">
                        <span class="flex size-8 items-center justify-center rounded-lg border border-line bg-raised"><span class="mark mark-{{ $platform }} size-3"></span></span>
                        <h3 class="text-base">{{ $tracker['label'] }}</h3>
                        @if ($tracker['covered'])
                            <span class="chip chip-status ml-auto text-success" data-connection="connected"><span class="chip-dot"></span>Verbunden</span>
                        @else
                            <span @class(['chip chip-status ml-auto', 'text-warning' => $platform !== 'github', 'text-white/50' => $platform === 'github']) data-connection="disconnected">Nicht verbunden</span>
                        @endif
                    </div>
                    <div class="flex flex-1 flex-col p-4">
                        @if ($source && isset($sourceLabels[$source]))
                            <div><span class="chip chip-meta {{ $sourceLabels[$source][1] }}" title="{{ $sourceLabels[$source][2] }}" data-source="{{ $source }}">{{ $sourceLabels[$source][0] }}</span></div>
                        @endif
                        @if ($links)
                            <ul class="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm" data-links>
                                @foreach ($links as $link)
                                    <li>
                                        @if ($link['url'])
                                            <a href="{{ $link['url'] }}" target="_blank" rel="noopener" class="link">{{ $link['label'] }}</a>
                                        @else
                                            <span class="text-white/80">{{ $link['label'] }}</span>
                                        @endif
                                    </li>
                                @endforeach
                            </ul>
                        @elseif (! $tracker['covered'] && ! $hasKeys($tracker['inherited'] ?? null))
                            <p class="text-sm text-white/45">{{ $platform === 'github' ? 'Issues im Repository gehen nicht an nyrus.' : 'Tickets kommen noch nicht hier an.' }}</p>
                        @endif
                        @if ($hasKeys($tracker['inherited'] ?? null))
                            <div class="mt-3 flex flex-wrap items-center gap-2 text-sm" data-inherited>
                                <span class="chip chip-meta text-white/60" data-source="inherited">geerbt</span>
                                <span class="muted">von Gruppe
                                    @if ($groupUrl)
                                        <a href="{{ $groupUrl }}" class="link" data-inherited-group>{{ $group['name'] }}</a>
                                    @else
                                        {{ $group['name'] ?? '' }}
                                    @endif
                                </span>
                            </div>
                            <ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm" data-inherited-links>
                                @foreach (\App\Services\ProjectOverview::keyLinks($platform, $tracker['inherited'], $trackerLinks) as $link)
                                    <li>
                                        @if ($link['url'])
                                            <a href="{{ $link['url'] }}" target="_blank" rel="noopener" class="link">{{ $link['label'] }}</a>
                                        @else
                                            <span class="text-white/80">{{ $link['label'] }}</span>
                                        @endif
                                    </li>
                                @endforeach
                            </ul>
                        @endif
                        @if ($tracker['detached'] && $hasKeys($tracker['inbudget']))
                            <p class="muted mt-2 text-xs" data-inbudget-hint>inBudget: <span class="font-mono">{{ implode(', ', array_merge($tracker['inbudget']['teamKeys'], $tracker['inbudget']['projectKeys'])) }}</span></p>
                        @elseif ($tracker['editable'] && ! $tracker['detached'] && $hasKeys($tracker['inbudget']) && $hasKeys($tracker['manual']))
                            @php($ignored = collect(['teamKeys', 'projectKeys'])->filter(fn ($f) => $tracker['inbudget'][$f] && $tracker['manual'][$f])->flatMap(fn ($f) => $tracker['manual'][$f])->all())
                            @if ($ignored)
                                <p class="muted mt-2 text-xs" data-overridden title="inBudget hat einen Wert. Entknüpfe, damit deiner gilt.">Ignoriert: <span class="font-mono line-through">{{ implode(', ', $ignored) }}</span></p>
                            @endif
                        @endif

                        {{-- actions --}}
                        <div class="mt-auto flex flex-wrap gap-2 pt-4" data-actions>
                            @if ($tracker['editable'])
                                @php($fields = $fieldsFor[$platform])
                                @if ($tracker['detached'])
                                    <x-modal-button for="edit-{{ $platform }}">Bearbeiten</x-modal-button>
                                    <x-modal-button for="relink-{{ $platform }}">Wieder verknüpfen</x-modal-button>
                                    @php($modals[] = ['kind' => 'keys', 'id' => "edit-{$platform}", 'title' => "{$tracker['label']}: dein Wert", 'tracker' => $tracker, 'detached' => true, 'fields' => array_keys($fields), 'submit' => 'Speichern', 'note' => 'Bleibt entknüpft von inBudget.'])
                                    @php($modals[] = ['kind' => 'relink', 'id' => "relink-{$platform}", 'title' => "{$tracker['label']} wieder mit inBudget verknüpfen?", 'tracker' => $tracker])
                                @elseif ($hasKeys($tracker['inbudget']))
                                    @php($open = array_values(array_filter(array_keys($fields), fn ($f) => ! $tracker['inbudget'][$f])))
                                    @if ($open)
                                        <x-modal-button for="supplement-{{ $platform }}">Ergänzen</x-modal-button>
                                        @php($modals[] = ['kind' => 'keys', 'id' => "supplement-{$platform}", 'title' => "{$tracker['label']} ergänzen", 'tracker' => $tracker, 'detached' => null, 'fields' => $open, 'submit' => 'Speichern', 'note' => 'Nur was inBudget nicht hat. Leer lassen entfernt die Ergänzung.'])
                                    @endif
                                    <x-modal-button for="detach-{{ $platform }}">Entknüpfen</x-modal-button>
                                    @php($modals[] = ['kind' => 'keys', 'id' => "detach-{$platform}", 'title' => "{$tracker['label']} von inBudget entknüpfen?", 'tracker' => $tracker, 'detached' => true, 'fields' => array_keys($fields), 'submit' => 'Entknüpfen', 'note' => 'Danach gilt dein Wert, auch wenn inBudget einen hat.', 'prefill' => 'inbudget'])
                                @elseif ($hasKeys($tracker['manual']))
                                    <x-modal-button for="edit-{{ $platform }}">Bearbeiten</x-modal-button>
                                    @php($modals[] = ['kind' => 'keys', 'id' => "edit-{$platform}", 'title' => "{$tracker['label']} bearbeiten", 'tracker' => $tracker, 'detached' => null, 'fields' => array_keys($fields), 'submit' => 'Speichern', 'note' => 'Leer lassen entfernt die Verknüpfung. Liefert inBudget später einen Wert, gilt dieser.'])
                                @else
                                    <x-modal-button for="link-{{ $platform }}" :variant="$tracker['covered'] ? 'btn-ghost' : 'btn'">Verknüpfen</x-modal-button>
                                    @php($modals[] = ['kind' => 'keys', 'id' => "link-{$platform}", 'title' => "{$tracker['label']} verknüpfen", 'tracker' => $tracker, 'detached' => null, 'fields' => array_keys($fields), 'submit' => 'Verknüpfen', 'note' => 'inBudget hat keinen Wert. Liefert inBudget später einen, gilt dieser.'])
                                @endif
                            @elseif ($tracker['manualEntries'])
                                <x-modal-button :for="$entryDialog($tracker['manualEntries'][0])">Bearbeiten</x-modal-button>
                            @elseif (! $tracker['covered'] && $row['githubUrl'])
                                <a class="btn-ghost" href="{{ route('repositories.index', ['add' => 1, 'repository_url' => $row['githubUrl']] + $listQuery) }}">Verknüpfen</a>
                            @endif
                        </div>
                        @if ($groupUrl && in_array($platform, \App\Services\ProjectOverview::TICKET_TRACKERS, true))
                            <a href="{{ $groupUrl }}" class="link mt-3 inline-flex items-center gap-1 text-xs" data-group-level-link><x-icon name="folder" class="size-3.5" />Auf Gruppenebene bearbeiten</a>
                        @endif
                    </div>
                </section>
            @empty
                <p class="muted text-sm">nyrus hat keinen Tracker eingerichtet.</p>
            @endforelse
            @foreach ($row['others'] as $other)
                <section class="card flex flex-col overflow-hidden border-success/25">
                    <div class="flex items-center gap-3 border-b border-line px-4 py-3">
                        <span class="flex size-8 items-center justify-center rounded-lg border border-line bg-raised"><span class="mark mark-other size-3"></span></span>
                        <h3 class="text-base">{{ $other['linearWorkspaceId'] ?? 'Anderer Tracker' }}</h3>
                        <span class="chip chip-status ml-auto text-success"><span class="chip-dot"></span>Verbunden</span>
                    </div>
                    <div class="flex flex-1 flex-col p-4">
                        <div><span class="chip chip-meta text-white/60">manuell</span></div>
                        <div class="mt-auto pt-4"><x-modal-button :for="$entryDialog($other)">Bearbeiten</x-modal-button></div>
                    </div>
                </section>
            @endforeach
        </div>

        {{-- group --}}
        @if ($group)
            @php($others = array_values(array_filter($group['rows'], fn ($r) => $r['key'] !== $row['key'])))
            <h2 class="section-title mt-10">Gruppe</h2>
            <div class="card mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5" data-group-section="{{ $group['key'] }}">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gold/25 bg-gold/10 text-gold"><x-icon name="folder" /></span>
                <div class="min-w-0 flex-1 basis-64">
                    <div class="flex flex-wrap items-center gap-2">
                        <h3 class="text-base" data-group-name>{{ $group['name'] }}</h3>
                        @include('partials.group-chips', ['group' => $group])
                    </div>
                    @if ($others)
                        <p class="mt-1.5 text-sm" data-group-members title="Tickets für ein Repo dieser Gruppe bekommen alle Repos der Gruppe.">
                            <span class="muted">Mit</span>
                            @foreach ($others as $other)
                                @php([$otherOwner, $otherRepo] = explode('/', $other['key'], 2))
                                <a class="link" href="{{ route('repositories.show', ['owner' => $otherOwner, 'repo' => $otherRepo] + $listQuery) }}">{{ $other['name'] }}</a>{{ $loop->last ? '' : ',' }}
                            @endforeach
                        </p>
                    @else
                        <p class="muted mt-1.5 text-sm">Keine weiteren Repos.</p>
                    @endif
                </div>
                <div class="flex flex-wrap gap-2">
                    <x-modal-button for="group-change">Gruppe ändern</x-modal-button>
                    <a href="{{ route('repositories.group', ['key' => $group['key']] + $listQuery) }}" class="btn-ghost">Gruppe öffnen</a>
                </div>
            </div>
        @endif

        {{-- settings per config entry --}}
        <h2 class="section-title mt-10">Einstellungen</h2>
        @if (! $row['entries'])
            <div class="notice mt-4 border-warning/30" data-no-entries>
                <span class="notice-dot text-warning" aria-hidden="true"></span>
                <span>Noch kein Eintrag in nyrus. Verknüpfe oben einen Tracker.</span>
            </div>
        @else
            <div class="card divided mt-4 overflow-hidden">
                @foreach ($row['entries'] as $entry)
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5" data-entry="{{ $entry['_id'] }}">
                        <span class="flex w-36 items-center gap-2 font-medium text-white"><span class="mark mark-{{ isset(\App\Services\ProjectOverview::LABELS[$entry['_tracker']]) ? $entry['_tracker'] : 'other' }}"></span>{{ \App\Services\ProjectOverview::LABELS[$entry['_tracker']] ?? ($entry['linearWorkspaceId'] ?? 'Ohne Tracker') }}</span>
                        <span class="text-sm"><span class="muted">Branch</span> <span class="font-mono text-white/80">{{ $entry['baseBranch'] ?? 'main' }}</span></span>
                        @if ($entry['_active'])
                            <span class="chip chip-status text-success"><span class="chip-dot"></span>aktiv</span>
                        @else
                            <span class="chip chip-status text-white/55"><span class="chip-dot"></span>inaktiv</span>
                        @endif
                        <span @class(['chip chip-meta', 'text-gold-light' => $entry['_managed'], 'text-white/60' => ! $entry['_managed']])>{{ $entry['_managed'] ? 'von inBudget' : 'manuell' }}</span>
                        <x-modal-button :for="$entryDialog($entry)" class="ml-auto">Bearbeiten</x-modal-button>
                    </div>
                @endforeach
            </div>
        @endif

        {{-- modals: tracker connections --}}
        @foreach ($modals as $modal)
            @php($tracker = $modal['tracker'])
            @php($platform = $tracker['platform'])
            @php($fromOld = old('_dialog') === $modal['id'])
            <x-modal :id="$modal['id']" :title="$modal['title']">
                <form method="POST" action="{{ route('repositories.manual') }}" class="grid gap-4" data-busy-form data-manual-form="{{ $platform }}" data-form="{{ $modal['id'] }}">
                    @csrf
                    <input type="hidden" name="repo" value="{{ $repoName }}">
                    <input type="hidden" name="platform" value="{{ $platform }}">
                    <input type="hidden" name="_detail" value="{{ $row['key'] }}">
                    <input type="hidden" name="_dialog" value="{{ $modal['id'] }}">
                    {!! $hiddenQuery !!}
                    @if ($modal['kind'] === 'relink')
                        <input type="hidden" name="detached" value="0">
                        <input type="hidden" name="teamKeys" value="">
                        <input type="hidden" name="projectKeys" value="">
                        <p class="text-sm">
                            @if ($hasKeys($tracker['inbudget']))
                                Danach gilt wieder inBudget: <span class="font-mono text-white">{{ implode(', ', array_merge($tracker['inbudget']['teamKeys'], $tracker['inbudget']['projectKeys'])) }}</span>. Dein Wert wird entfernt.
                            @else
                                inBudget hat keinen Wert: danach ist {{ $tracker['label'] }} nicht verbunden.
                            @endif
                        </p>
                        <div class="flex flex-wrap gap-3">
                            <button class="btn" data-busy-label="Verknüpfe…">Wieder verknüpfen</button>
                            <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                        </div>
                    @else
                        @if ($modal['detached'] !== null)
                            <input type="hidden" name="detached" value="{{ $modal['detached'] ? 1 : 0 }}">
                        @endif
                        @foreach (array_keys($fieldsFor[$platform]) as $field)
                            @unless (in_array($field, $modal['fields'], true))
                                <input type="hidden" name="{{ $field }}" value="{{ $joined($tracker['manual'], $field) }}">
                            @endunless
                        @endforeach
                        <p class="muted text-sm">{{ $modal['note'] }}</p>
                        @foreach ($modal['fields'] as $field)
                            @php([$label, $hint] = $fieldsFor[$platform][$field])
                            @php($current = $joined($tracker['manual'], $field) ?: (($modal['prefill'] ?? null) === 'inbudget' ? $joined($tracker['inbudget'], $field) : ''))
                            <label class="label">{{ $label }}
                                <input name="{{ $field }}" value="{{ $fromOld ? old($field) : $current }}" class="field font-mono" placeholder="{{ $hint }}">
                                @if ($tracker['inbudget'] && $tracker['inbudget'][$field])
                                    <span class="muted mt-1 block">inBudget: <span class="font-mono">{{ $joined($tracker['inbudget'], $field) }}</span></span>
                                @endif
                                @if ($fromOld)
                                    @error($field) <span class="mt-1 block text-danger">{{ $message }}</span> @enderror
                                @endif
                            </label>
                        @endforeach
                        <div class="flex flex-wrap gap-3">
                            <button class="btn" data-busy-label="Speichere…">{{ $modal['submit'] }}</button>
                            <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                        </div>
                    @endif
                </form>
            </x-modal>
        @endforeach

        {{-- modals: group --}}
        @if ($group)
            @php($choices = array_filter($groups, fn ($g) => $g['key'] !== $group['key'] && ! str_starts_with($g['key'], 'repo:')))
            @php($customer = $row['statusRepo'] !== null ? ($row['group']['customer'] ?? null) : null)
            @php($fromOld = old('_dialog') === 'group-change')
            @php($mode = $fromOld ? old('mode') : ($choices ? 'existing' : 'new'))
            <x-modal id="group-change" title="Gruppe ändern">
                <form method="POST" action="{{ route('repositories.group.update') }}" class="grid gap-3 text-sm" data-group-form data-busy-form>
                    @csrf
                    <input type="hidden" name="action" value="move">
                    <input type="hidden" name="repo" value="{{ $row['key'] }}">
                    <input type="hidden" name="_detail" value="{{ $row['key'] }}">
                    <input type="hidden" name="_dialog" value="group-change">
                    {!! $hiddenQuery !!}
                    <p class="muted">Tickets für ein Repo dieser Gruppe bekommen alle Repos der Gruppe.</p>
                    @if ($choices)
                        <label class="flex flex-wrap items-center gap-x-3 gap-y-2 text-white/80">
                            <input type="radio" name="mode" value="existing" id="group-mode-existing" @checked($mode === 'existing') class="size-4 accent-gold">
                            <span>Bestehende Gruppe</span>
                            <select name="target" aria-label="Bestehende Gruppe" onchange="document.getElementById('group-mode-existing').checked = true"
                                    class="select w-full">
                                @foreach ($choices as $choice)
                                    <option value="{{ $choice['key'] }}" @selected($fromOld && old('target') === $choice['key'])>{{ $choice['name'] }} ({{ $choice['size'] }} {{ $choice['size'] === 1 ? 'Repo' : 'Repos' }}{{ $choice['source'] === 'manual' ? ', manuell' : '' }})</option>
                                @endforeach
                            </select>
                        </label>
                    @endif
                    <label class="flex flex-wrap items-center gap-x-3 gap-y-2 text-white/80">
                        <input type="radio" name="mode" value="new" id="group-mode-new" @checked($mode === 'new') class="size-4 accent-gold">
                        <span>Neue Gruppe</span>
                        <input name="name" value="{{ $fromOld ? old('name') : '' }}" placeholder="z.B. Zuriga" aria-label="Name der neuen Gruppe" onfocus="document.getElementById('group-mode-new').checked = true"
                               class="input">
                    </label>
                    @if (count($group['rows']) > 1 || ! str_starts_with($group['key'], 'repo:'))
                        <label class="flex items-center gap-3 text-white/80">
                            <input type="radio" name="mode" value="alone" @checked($mode === 'alone') class="size-4 accent-gold">
                            Eigene Gruppe (allein)
                        </label>
                    @endif
                    @if ($customer && ($group['source'] !== 'inbudget' || $group['customer'] !== $customer))
                        <label class="flex items-center gap-3 text-white/80">
                            <input type="radio" name="mode" value="customer" @checked($mode === 'customer') class="size-4 accent-gold">
                            Zurück zum Kunden ({{ $customer }})
                        </label>
                    @endif
                    @if ($fromOld)
                        @error('name') <span class="block text-danger">{{ $message }}</span> @enderror
                        @error('target') <span class="block text-danger">{{ $message }}</span> @enderror
                        @error('mode') <span class="block text-danger">{{ $message }}</span> @enderror
                    @endif
                    <div class="mt-1 flex flex-wrap gap-3">
                        <button class="btn" data-busy-label="Speichere…">Gruppe ändern</button>
                        <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                    </div>
                </form>
            </x-modal>
        @endif

        {{-- modals: settings per config entry --}}
        @foreach ($row['entries'] as $entry)
            @php($name = $entry['_name'])
            @php($tracker = $entry['_tracker'])
            @php($managed = $entry['_managed'])
            @php($id = $entryDialog($entry))
            <x-modal :id="$id" :title="(\App\Services\ProjectOverview::LABELS[$tracker] ?? ($entry['linearWorkspaceId'] ?? 'Eintrag')).' · Einstellungen'" wide>
                <form method="POST" action="{{ route('repositories.update', $name) }}" class="grid gap-4 sm:grid-cols-2" data-entry-form="{{ $entry['_id'] }}">
                    @csrf
                    @method('PUT')
                    <input type="hidden" name="_detail" value="{{ $row['key'] }}">
                    <input type="hidden" name="_dialog" value="{{ $id }}">
                    {!! $hiddenQuery !!}
                    <label class="label">Basis-Branch
                        <input name="baseBranch" value="{{ $entry['baseBranch'] ?? 'main' }}" class="field font-mono">
                    </label>
                    <label class="flex items-center gap-2.5 self-end pb-2.5 text-sm text-white/80">
                        <input type="hidden" name="isActive" value="0">
                        <input type="checkbox" name="isActive" value="1" @checked($entry['_active']) class="size-4 accent-gold"> aktiv
                    </label>
                    @unless ($managed)
                        @foreach ($fieldsFor[$tracker] as $field => [$label, $hint])
                            <label class="label">{{ $label }}
                                <input name="{{ $field }}" value="{{ implode(', ', (array) ($entry[$field] ?? [])) }}" class="field font-mono" placeholder="{{ $hint }}">
                            </label>
                        @endforeach
                    @endunless
                    <label class="label sm:col-span-2">Routing-Labels (erweitert, kommagetrennt)
                        <input name="routingLabels" value="{{ implode(', ', (array) ($entry['routingLabels'] ?? [])) }}" class="field">
                        <span class="muted mt-1 block">Nur wenn mehrere Repositories dasselbe Projekt teilen.</span>
                    </label>
                    <p class="muted text-xs break-all sm:col-span-2">Eintrag <span class="font-mono">{{ $entry['_id'] }}</span>@if ($entry['linearWorkspaceId'] ?? null) · Workspace <span class="font-mono">{{ $entry['linearWorkspaceId'] }}</span>@endif · Pfad <span class="font-mono">{{ $entry['repositoryPath'] ?? '–' }}</span></p>
                    <div class="flex flex-wrap gap-3 sm:col-span-2">
                        <button class="btn">Speichern</button>
                        <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                    </div>
                </form>
                @unless ($managed)
                    <form method="POST" action="{{ route('repositories.destroy', $name) }}" class="mt-5 flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-4"
                          onsubmit="return confirm('{{ $name }} aus nyrus entfernen?')">
                        @csrf
                        @method('DELETE')
                        {!! $hiddenQuery !!}
                        <label class="flex items-center gap-2 text-sm text-white/60">
                            <input type="checkbox" name="deleteFiles" value="1" class="size-4 accent-danger"> auch den Klon löschen
                        </label>
                        <button class="btn-danger ml-auto">Eintrag entfernen</button>
                    </form>
                @endunless
            </x-modal>
        @endforeach
    @endif
</x-app>
