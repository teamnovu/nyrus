<x-app :title="$group['name'] ?? 'Gruppe'">
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
            $hiddenQuery = collect($listQuery)->map(fn ($v, $k) => '<input type="hidden" name="_query['.e($k).']" value="'.e($v).'">')->implode('');
            $isCustomer = $group['source'] === 'inbudget' && ! str_starts_with($group['key'], 'repo:');
            $isManual = str_starts_with($group['key'], 'manual:');
            $memberKeys = array_column($group['rows'], 'key');
            $candidates = array_values(array_filter($rows, fn ($r) => ! in_array($r['key'], $memberKeys, true)));
            usort($candidates, fn ($a, $b) => strnatcasecmp($a['name'], $b['name']));
            $backToCustomer = $isManual && collect($group['rows'])->contains(fn ($r) => $r['statusRepo'] !== null && filled($r['group']['customer'] ?? null));
            $memberDialog = fn (array $row) => 'remove-'.\Illuminate\Support\Str::slug($row['key']);
            $fieldsFor = [
                'jira' => ['teamKeys' => ['Jira-Projekt', 'Key, z.B. SAY. Mehrere kommagetrennt.']],
                'clickup' => ['teamKeys' => ['ClickUp-Space', 'ID des Space (Zahl in der ClickUp-URL).'], 'projectKeys' => ['ClickUp-Liste', 'Name der Liste. Mehrere kommagetrennt.']],
            ];
            $hidden = fn (string $action) => csrf_field().'<input type="hidden" name="action" value="'.$action.'"><input type="hidden" name="group" value="'.e($group['key']).'">'.$hiddenQuery;
        @endphp

        <div class="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3">
            <div class="min-w-0">
                <p class="eyebrow">Gruppe</p>
                <h1 class="page-title break-words" data-group-title>{{ $group['name'] }}</h1>
            </div>
            <div class="ml-auto flex flex-wrap gap-2">
                <x-modal-button for="group-add" variant="btn">Repo hinzufügen</x-modal-button>
                <x-modal-button for="group-rename">{{ $isCustomer ? 'Als eigene Gruppe benennen' : 'Umbenennen' }}</x-modal-button>
                @if ($group['size'] > 1)
                    <x-modal-button for="group-dissolve">Auflösen</x-modal-button>
                @endif
                @if ($backToCustomer)
                    <x-modal-button for="group-customer">Zurück zu den Kunden</x-modal-button>
                @endif
            </div>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
            @include('partials.group-chips', ['group' => $group])
            @if ($group['customer'] && $group['customer'] !== $group['name'])
                <span class="chip text-white/60">Kunde {{ $group['customer'] }}</span>
            @endif
            <span class="muted">{{ $group['size'] }} {{ $group['size'] === 1 ? 'Repo' : 'Repos' }} · Tickets für ein Repo der Gruppe bekommen alle Repos der Gruppe.</span>
        </div>

        {{-- connections: the group's Jira/ClickUp, inherited by every repository of the group --}}
        @if ($trackers)
            <h2 class="mt-10 text-lg">Verbindungen</h2>
            <div class="mt-4 grid gap-4 md:grid-cols-2">
                @foreach ($trackers as $platform => $tracker)
                    <section class="card flex flex-col p-4" data-group-tracker="{{ $platform }}">
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-base">{{ $tracker['label'] }}</h3>
                            @if ($tracker['connected'])
                                <span class="chip text-gold" data-connection="connected"><span class="chip-dot"></span>Verbunden</span>
                            @else
                                <span class="chip text-warning" data-connection="disconnected">Nicht verbunden</span>
                            @endif
                        </div>
                        @if ($tracker['links'])
                            <ul class="mt-3 grid gap-1.5 text-sm" data-links>
                                @foreach ($tracker['links'] as $link)
                                    <li class="flex flex-wrap items-baseline gap-x-2" data-key="{{ $link['key'] }}">
                                        @if ($link['url'])
                                            <a href="{{ $link['url'] }}" target="_blank" rel="noopener" class="link font-mono">{{ $link['label'] }}</a>
                                        @else
                                            <span class="font-mono text-white/80">{{ $link['label'] }}</span>
                                        @endif
                                        @foreach ($link['sources'] as $source)
                                            @if ($source['kind'] === 'group')
                                                <span class="text-xs text-gold-light/80" data-key-source="group">für die Gruppe</span>
                                            @else
                                                @php([$sourceOwner, $sourceRepo] = explode('/', $source['row']['key'], 2))
                                                <span class="muted text-xs" data-key-source="{{ $source['kind'] }}">{{ $source['kind'] === 'inbudget' ? 'aus inBudget' : 'von' }} <a class="link" href="{{ route('repositories.show', ['owner' => $sourceOwner, 'repo' => $sourceRepo] + $listQuery) }}">{{ $source['row']['name'] }}</a></span>
                                            @endif
                                        @endforeach
                                    </li>
                                @endforeach
                            </ul>
                        @endif
                        <div class="mt-auto flex flex-wrap gap-2 pt-4" data-actions>
                            @if ($tracker['hasOwn'])
                                <x-modal-button for="group-edit-{{ $platform }}">Bearbeiten</x-modal-button>
                                <x-modal-button for="group-clear-{{ $platform }}">Entfernen</x-modal-button>
                            @else
                                <x-modal-button for="group-link-{{ $platform }}" :variant="$tracker['connected'] ? 'btn-ghost' : 'btn'">Verknüpfen</x-modal-button>
                            @endif
                        </div>
                    </section>
                @endforeach
            </div>
        @endif

        <h2 class="mt-10 text-lg">Repos</h2>
        <div class="card divided mt-4 overflow-hidden">
            @foreach ($group['rows'] as $row)
                @php([$owner, $repo] = explode('/', $row['key'], 2))
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5" data-member="{{ $row['key'] }}">
                    <a href="{{ route('repositories.show', ['owner' => $owner, 'repo' => $repo] + $listQuery) }}" class="min-w-0 flex-1 basis-56 truncate">
                        <span class="font-medium text-white">{{ $row['name'] }}</span>@if ($row['owner']) <span class="muted text-sm">{{ $row['owner'] }}</span>@endif
                    </a>
                    @include('partials.project-chips', ['row' => $row])
                    @if ($group['size'] > 1)
                        <x-modal-button :for="$memberDialog($row)" class="ml-auto !h-8" title="Repo in eine eigene Gruppe verschieben">Entfernen</x-modal-button>
                    @endif
                </div>
            @endforeach
        </div>

        {{-- modals: the group's trackers --}}
        @foreach ($trackers as $platform => $tracker)
            @php($id = $tracker['hasOwn'] ? "group-edit-{$platform}" : "group-link-{$platform}")
            @php($fromOld = old('_dialog') === $id)
            <x-modal :id="$id" :title="$tracker['label'].($tracker['hasOwn'] ? ' der Gruppe bearbeiten' : ' für die Gruppe verknüpfen')">
                <form method="POST" action="{{ route('repositories.group.trackers') }}" class="grid gap-4" data-busy-form data-group-tracker-form="{{ $platform }}">
                    @csrf
                    <input type="hidden" name="group" value="{{ $group['key'] }}">
                    <input type="hidden" name="platform" value="{{ $platform }}">
                    <input type="hidden" name="_dialog" value="{{ $id }}">
                    {!! $hiddenQuery !!}
                    <p class="muted text-sm">Gilt für alle Repos der Gruppe.</p>
                    @foreach ($fieldsFor[$platform] as $field => [$label, $hint])
                        <label class="label">{{ $label }}
                            <input name="{{ $field }}" value="{{ $fromOld ? old($field) : implode(', ', $tracker['own'][$field]) }}" class="field font-mono" placeholder="{{ $hint }}">
                            @if ($fromOld)
                                @error($field) <span class="mt-1 block text-danger">{{ $message }}</span> @enderror
                            @endif
                        </label>
                    @endforeach
                    <div class="flex flex-wrap gap-3">
                        <button class="btn" data-busy-label="Speichere…">{{ $tracker['hasOwn'] ? 'Speichern' : 'Verknüpfen' }}</button>
                        <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                    </div>
                </form>
            </x-modal>
            @if ($tracker['hasOwn'])
                <x-modal :id="'group-clear-'.$platform" :title="$tracker['label'].' der Gruppe entfernen?'">
                    <form method="POST" action="{{ route('repositories.group.trackers') }}" class="grid gap-4" data-busy-form data-group-tracker-clear="{{ $platform }}">
                        @csrf
                        <input type="hidden" name="group" value="{{ $group['key'] }}">
                        <input type="hidden" name="platform" value="{{ $platform }}">
                        <input type="hidden" name="teamKeys" value="">
                        <input type="hidden" name="projectKeys" value="">
                        {!! $hiddenQuery !!}
                        <p class="text-sm">Entfernt <span class="font-mono text-white">{{ implode(', ', array_merge($tracker['own']['teamKeys'], $tracker['own']['projectKeys'])) }}</span>. Die Repos behalten ihre eigenen Werte.</p>
                        <div class="flex flex-wrap gap-3">
                            <button class="btn-danger" data-busy-label="Entferne…">Entfernen</button>
                            <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                        </div>
                    </form>
                </x-modal>
            @endif
        @endforeach

        {{-- modals: members --}}
        @if ($group['size'] > 1)
            @foreach ($group['rows'] as $row)
                <x-modal :id="$memberDialog($row)" :title="'«'.$row['name'].'» aus der Gruppe nehmen?'">
                    <form method="POST" action="{{ route('repositories.group.update') }}" class="grid gap-4" data-busy-form data-remove-form="{{ $row['key'] }}">
                        {!! $hidden('remove') !!}
                        <input type="hidden" name="repo" value="{{ $row['key'] }}">
                        <p class="text-sm">Das Repo kommt in eine eigene Gruppe.</p>
                        <div class="flex flex-wrap gap-3">
                            <button class="btn-danger" data-busy-label="Speichere…">Entfernen</button>
                            <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                        </div>
                    </form>
                </x-modal>
            @endforeach
        @endif

        {{-- modals: group --}}
        <x-modal id="group-add" title="Repo zu «{{ $group['name'] }}» hinzufügen">
            <form method="POST" action="{{ route('repositories.group.update') }}" class="grid gap-4" data-busy-form>
                {!! $hidden('add') !!}
                <input type="hidden" name="_dialog" value="group-add">
                <label class="label">Repository
                    <select name="repo" required class="field">
                        @foreach ($candidates as $candidate)
                            <option value="{{ $candidate['key'] }}">{{ $candidate['owner'] ? $candidate['owner'].'/' : '' }}{{ $candidate['name'] }}{{ ($candidate['group']['name'] ?? null) && $candidate['group']['name'] !== $candidate['name'] && ! str_starts_with($candidate['group']['key'], 'repo:') ? ' – '.$candidate['group']['name'] : '' }}</option>
                        @endforeach
                    </select>
                </label>
                @if (! $isManual)
                    <p class="muted text-sm">nyrus gruppiert manuell nach Namen: daraus wird die manuelle Gruppe «{{ $group['name'] }}» mit allen Repos.</p>
                @endif
                <div class="flex flex-wrap gap-3">
                    <button class="btn" data-busy-label="Speichere…">Hinzufügen</button>
                    <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                </div>
            </form>
        </x-modal>

        <x-modal id="group-rename" :title="$isCustomer ? 'Als eigene Gruppe benennen' : 'Gruppe umbenennen'">
            <form method="POST" action="{{ route('repositories.group.update') }}" class="grid gap-4" data-busy-form>
                {!! $hidden('rename') !!}
                <input type="hidden" name="_dialog" value="group-rename">
                <label class="label">Name
                    <input name="name" value="{{ old('_dialog') === 'group-rename' ? old('name') : $group['name'] }}" required class="field">
                    @if (old('_dialog') === 'group-rename')
                        @error('name') <span class="mt-1 block text-danger">{{ $message }}</span> @enderror
                    @endif
                </label>
                @if ($isCustomer)
                    <p class="muted text-sm">Macht daraus eine manuelle Gruppe mit allen {{ $group['size'] }} Repos. Spätere Änderungen beim Kunden in inBudget gelten dann nicht mehr für sie.</p>
                @endif
                <div class="flex flex-wrap gap-3">
                    <button class="btn" data-busy-label="Speichere…">Speichern</button>
                    <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                </div>
            </form>
        </x-modal>

        @if ($group['size'] > 1)
            <x-modal id="group-dissolve" title="Gruppe auflösen?">
                <form method="POST" action="{{ route('repositories.group.update') }}" class="grid gap-4" data-busy-form>
                    {!! $hidden('dissolve') !!}
                    <p class="text-sm">Jedes der {{ $group['size'] }} Repos kommt in eine eigene Gruppe. Tickets bekommen dann nur noch ihr Repository.</p>
                    <div class="flex flex-wrap gap-3">
                        <button class="btn-danger" data-busy-label="Löse auf…">Auflösen</button>
                        <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                    </div>
                </form>
            </x-modal>
        @endif

        @if ($backToCustomer)
            <x-modal id="group-customer" title="Zurück zu den Kunden-Gruppen?">
                <form method="POST" action="{{ route('repositories.group.update') }}" class="grid gap-4" data-busy-form>
                    {!! $hidden('customer') !!}
                    <p class="text-sm">Die Repos kommen wieder in die Gruppe ihres inBudget-Kunden. Manuell angelegte Repos werden allein.</p>
                    <div class="flex flex-wrap gap-3">
                        <button class="btn" data-busy-label="Speichere…">Zurück zu den Kunden</button>
                        <button type="button" class="btn-ghost" data-dialog-close>Abbrechen</button>
                    </div>
                </form>
            </x-modal>
        @endif
    @endif
</x-app>
