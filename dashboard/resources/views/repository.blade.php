<x-app :title="$row['name'] ?? 'Projekt'">
    <a href="{{ route('repositories.index', $listQuery) }}" class="link inline-flex items-center gap-1 text-sm" data-back-link>
        <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd"/></svg>
        Alle Projekte
    </a>

    @if ($error)
        <div class="notice mt-6">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>Konfiguration konnte nicht geladen werden: {{ $error }}</span>
        </div>
    @else
        @php
            $repoName = $row['isRepo'] ? $row['owner'].'/'.$row['name'] : null;
            $hiddenQuery = collect($listQuery)->map(fn ($v, $k) => '<input type="hidden" name="_query['.e($k).']" value="'.e($v).'">')->implode('');
            $fieldsFor = [
            'jira' => ['teamKeys' => ['Jira-Projekt', 'Key des Jira-Projekts, z.B. SAY. Mehrere kommagetrennt.']],
            'clickup' => ['teamKeys' => ['ClickUp-Space', 'ID des Space (die Zahl in der ClickUp-URL).'], 'projectKeys' => ['ClickUp-Liste', 'Name der Liste. Mehrere kommagetrennt.']],
            'github' => ['teamKeys' => ['GitHub-Repository', 'owner/name, dessen Issues hierher gehen.']],
            'other' => ['teamKeys' => ['Team-Keys', 'Kommagetrennt.'], 'projectKeys' => ['Projekte', 'Kommagetrennt.']],
            ];
        @endphp

        <div class="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
            <div class="min-w-0">
                <p class="eyebrow">Projekt</p>
                <h1 class="page-title break-words">{{ $row['name'] }}@if ($row['owner']) <span class="text-xl font-normal text-white/40 sm:text-2xl">{{ $row['owner'] }}</span>@endif</h1>
            </div>
            @if ($row['githubUrl'])
                <a href="{{ $row['githubUrl'] }}" target="_blank" rel="noopener" class="link ml-auto text-sm">Auf GitHub öffnen</a>
            @endif
        </div>
        <div class="mt-3">@include('partials.project-chips', ['row' => $row])</div>
        <p class="muted mt-3 text-sm">
            @if ($row['projects'])
                inBudget: {{ implode(' · ', $row['projects']) }}@if ($row['inbudgetBranch']) · Branch laut inBudget <span class="font-mono">{{ $row['inbudgetBranch'] }}</span>@endif
            @elseif ($row['inbudget'])
                Kommt aus inBudget.
            @else
                Nicht in inBudget, hier manuell angelegt.
            @endif
        </p>

        {{-- trackers --}}
        <h2 class="mt-10 text-lg">Tracker</h2>
        <p class="muted mt-1 text-sm">Woher nyrus Tickets für dieses Repository bekommt. Was inBudget liefert, gilt; wo inBudget nichts hat, kannst du es hier ergänzen. Liefert inBudget später einen Wert, ersetzt er deine Ergänzung.</p>

        <div class="card divided mt-4">
            @forelse ($row['trackers'] as $platform => $tracker)
                <section class="px-4 py-5 sm:px-5" data-tracker="{{ $platform }}">
                    <div class="flex flex-wrap items-center gap-2">
                        <h3 class="text-base">{{ $tracker['label'] }}</h3>
                        @if ($tracker['covered'])
                            <span class="chip text-gold"><span class="chip-dot"></span>verknüpft</span>
                        @elseif ($platform === 'github')
                            <span class="chip text-white/45">nicht eingerichtet</span>
                        @else
                            <span class="chip text-warning">fehlt</span>
                        @endif
                    </div>

                    @if ($platform === 'github')
                        <p class="muted mt-2 text-sm">
                            @if ($tracker['covered'])
                                nyrus nimmt Issues in <span class="font-mono text-white/70">{{ $repoName ?? $row['name'] }}</span> an, die dem nyrus-Account zugewiesen werden. Das funktioniert auch ohne Jira oder ClickUp.
                            @else
                                GitHub Issues sind für dieses Repository nicht eingerichtet.
                            @endif
                        </p>
                    @elseif ($tracker['editable'])
                        @php($fields = $fieldsFor[$platform])
                        @php($fromOld = old('platform') === $platform && old('repo') === $repoName)
                        @php($unlocked = collect(array_keys($fields))->contains(fn ($f) => empty($tracker['inbudget'][$f])))
                        <form method="POST" action="{{ route('repositories.manual') }}" class="mt-4 grid gap-4 sm:grid-cols-2" data-busy-form data-manual-form="{{ $platform }}">
                            @csrf
                            <input type="hidden" name="repo" value="{{ $repoName }}">
                            <input type="hidden" name="platform" value="{{ $platform }}">
                            <input type="hidden" name="_detail" value="{{ $row['key'] }}">
                            {!! $hiddenQuery !!}
                            @if (! isset($fields['projectKeys']))
                                <input type="hidden" name="projectKeys" value="{{ implode(', ', $tracker['manual']['projectKeys']) }}">
                            @endif
                            @foreach ($fields as $field => [$label, $hint])
                                @php($fromInbudget = $tracker['inbudget'][$field])
                                @php($manual = implode(', ', $tracker['manual'][$field]))
                                <div class="text-sm" data-field="{{ $field }}">
                                    <div class="label">{{ $label }}</div>
                                    @if ($fromInbudget)
                                        <div class="mt-1.5 flex min-h-10 flex-wrap items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-white/[0.06]" data-inbudget-value>
                                            <span class="font-mono text-white">{{ implode(', ', $fromInbudget) }}</span>
                                            <span class="chip text-gold-light/80">aus inBudget</span>
                                        </div>
                                        <input type="hidden" name="{{ $field }}" value="{{ $manual }}">
                                        @if ($manual !== '')
                                            <p class="muted mt-1 text-xs" data-overridden>Deine Ergänzung <span class="font-mono line-through">{{ $manual }}</span> ist überschrieben durch inBudget.</p>
                                        @endif
                                    @else
                                        <input name="{{ $field }}" value="{{ $fromOld ? old($field) : $manual }}" class="field font-mono" aria-label="{{ $label }}">
                                        <p class="muted mt-1 text-xs">In inBudget nicht hinterlegt. {{ $hint }}</p>
                                        @if ($fromOld)
                                            @error($field) <span class="mt-1 block text-danger">{{ $message }}</span> @enderror
                                        @endif
                                    @endif
                                </div>
                            @endforeach
                            @if ($unlocked)
                                <div class="flex flex-wrap items-center gap-3 sm:col-span-2">
                                    <button class="btn" data-busy-label="Speichere und gleiche ab…">Ergänzung speichern</button>
                                    <span class="muted text-xs">nyrus gleicht danach mit inBudget ab. Leeres Feld entfernt die Ergänzung.</span>
                                </div>
                            @endif
                        </form>
                    @else
                        <div class="muted mt-2 space-y-1 text-sm">
                            @if ($tracker['effective']['teamKeys'] || $tracker['effective']['projectKeys'])
                                <p>Aus inBudget: <span class="font-mono text-white/80">{{ implode(', ', array_merge($tracker['effective']['teamKeys'], $tracker['effective']['projectKeys'])) }}</span></p>
                            @endif
                            @foreach ($tracker['manualEntries'] as $entry)
                                <p>Manueller Eintrag: <span class="font-mono text-white/80">{{ implode(', ', array_merge((array) ($entry['teamKeys'] ?? []), (array) ($entry['projectKeys'] ?? []))) ?: '–' }}</span> (unten bearbeiten)</p>
                            @endforeach
                            @if (! $tracker['covered'])
                                <p>Nicht verknüpft.
                                    @if ($row['githubUrl'])
                                        <a class="link" href="{{ route('repositories.index', ['add' => 1, 'repository_url' => $row['githubUrl']] + $listQuery) }}">{{ $tracker['label'] }} manuell einrichten</a>
                                    @endif
                                </p>
                            @endif
                        </div>
                    @endif
                </section>
            @empty
                <p class="muted px-5 py-6 text-sm">nyrus hat keinen Tracker eingerichtet.</p>
            @endforelse
            @foreach ($row['others'] as $other)
                <section class="px-4 py-5 sm:px-5">
                    <h3 class="text-base">{{ $other['linearWorkspaceId'] ?? 'Anderer Tracker' }}</h3>
                    <p class="muted mt-2 text-sm">Manueller Eintrag, unten bearbeiten.</p>
                </section>
            @endforeach
        </div>

        {{-- config entries --}}
        <h2 class="mt-10 text-lg">Einstellungen in nyrus</h2>
        <p class="muted mt-1 text-sm">Pro Tracker ein Eintrag. Basis-Branch und «aktiv» gelten nur in nyrus und bleiben beim Abgleich erhalten.</p>

        @if (! $row['entries'])
            <div class="notice mt-4" data-no-entries>
                <span class="notice-dot text-warning" aria-hidden="true"></span>
                <span>nyrus hat noch keinen Eintrag für dieses Repository. Ergänze oben ein Jira-Projekt oder eine ClickUp-Liste, dann legt nyrus ihn beim Abgleich an.</span>
            </div>
        @endif

        <div class="mt-4 space-y-4">
            @foreach ($row['entries'] as $entry)
                @php($name = $entry['_name'])
                @php($tracker = $entry['_tracker'])
                @php($managed = $entry['_managed'])
                <div class="card p-4 sm:p-5" data-entry="{{ $entry['_id'] }}">
                    <div class="flex flex-wrap items-center gap-2">
                        <h3 class="text-base">{{ \App\Services\ProjectOverview::LABELS[$tracker] ?? ($entry['linearWorkspaceId'] ?? 'Ohne Tracker') }}</h3>
                        <span @class(['chip', 'text-gold-light/80' => $managed, 'text-white/60' => ! $managed])>{{ $managed ? 'von inBudget angelegt' : 'manuell' }}</span>
                        @if ($entry['_active'])
                            <span class="chip text-gold"><span class="chip-dot"></span>aktiv</span>
                        @else
                            <span class="chip text-white/50">inaktiv</span>
                        @endif
                    </div>

                    <form method="POST" action="{{ route('repositories.update', $name) }}" class="mt-4 grid gap-4 sm:grid-cols-2">
                        @csrf
                        @method('PUT')
                        <input type="hidden" name="_detail" value="{{ $row['key'] }}">
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
                                    <input name="{{ $field }}" value="{{ implode(', ', (array) ($entry[$field] ?? [])) }}" class="field font-mono">
                                    <span class="muted mt-1 block text-xs">{{ $hint }}</span>
                                </label>
                            @endforeach
                        @endunless
                        <label class="label sm:col-span-2">Routing-Labels (erweitert)
                            <input name="routingLabels" value="{{ implode(', ', (array) ($entry['routingLabels'] ?? [])) }}" class="field">
                            <span class="muted mt-1 block text-xs">Nur nötig, wenn mehrere Repositories dasselbe Projekt teilen: Tickets mit diesem Label gehen hierher. Kommagetrennt.</span>
                        </label>
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2">
                            <button class="btn">Speichern</button>
                            @if ($managed)
                                <span class="muted text-xs">Tracker-Angaben kommen aus inBudget bzw. der Ergänzung oben.</span>
                            @endif
                        </div>
                    </form>

                    <p class="muted mt-4 text-xs break-all">Eintrag <span class="font-mono">{{ $entry['_id'] }}</span>@if ($entry['linearWorkspaceId'] ?? null) · Workspace <span class="font-mono">{{ $entry['linearWorkspaceId'] }}</span>@endif · Pfad <span class="font-mono">{{ $entry['repositoryPath'] ?? '–' }}</span></p>

                    @unless ($managed)
                        <form method="POST" action="{{ route('repositories.destroy', $name) }}" class="mt-4 flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-4"
                              onsubmit="return confirm('{{ $name }} aus nyrus entfernen?')">
                            @csrf
                            @method('DELETE')
                            {!! $hiddenQuery !!}
                            <label class="flex items-center gap-2 text-sm text-white/60">
                                <input type="checkbox" name="deleteFiles" value="1" class="size-4 accent-danger"> auch den Klon auf dem Server löschen
                            </label>
                            <button class="btn-danger ml-auto">Eintrag entfernen</button>
                        </form>
                    @endunless
                </div>
            @endforeach
        </div>
    @endif
</x-app>
