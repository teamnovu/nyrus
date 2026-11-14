<x-app title="inBudget-Abgleich">
    @php
        $fmtDate = fn ($iso) => \Illuminate\Support\Carbon::parse($iso)->timezone(config('app.timezone'))->format('d.m.Y H:i');
    @endphp
    <div class="sticky-bar -mt-3" data-sticky>
        <div class="flex h-12 items-center gap-3">
            <a href="{{ route('repositories.index', $listQuery) }}" class="back-link shrink-0" data-back-link><x-icon name="chevron-left" />Alle Projekte</a>
            <div class="sticky-title border-l border-line pl-3 text-sm" aria-hidden="true">inBudget-Abgleich</div>
        </div>
    </div>
    <div class="mt-4 flex flex-wrap items-end gap-4">
        <div class="min-w-0">
            <p class="eyebrow">Projekte</p>
            <h1 class="page-title">inBudget-Abgleich</h1>
        </div>
        @if ($inbudget)
            <form method="POST" action="{{ route('repositories.inbudget-sync') }}" class="ml-auto" data-busy-form>
                @csrf
                @foreach ($listQuery as $key => $value)
                    <input type="hidden" name="_query[{{ $key }}]" value="{{ $value }}">
                @endforeach
                <button class="btn" data-busy-label="Gleiche ab…" @disabled($inbudget['running'] ?? false)><x-icon name="refresh" />Jetzt abgleichen</button>
            </form>
        @endif
    </div>
    <p class="page-lead">inBudget liefert die Repositories (Git-Link eines Projekts oder Repository einer Ressource seines Kunden) und, falls hinterlegt, das Jira-Projekt oder die ClickUp-Liste dazu. Fehlt etwas, ergänzt du es im jeweiligen Projekt.</p>

    @if (! $inbudget)
        <div class="notice mt-6">
            <span class="notice-dot text-white/40" aria-hidden="true"></span>
            <span>nyrus hat keine inBudget-Anbindung (INBUDGET_URL ist nicht gesetzt) oder ist nicht erreichbar.</span>
        </div>
    @else
        @php
            $result = $inbudget['result'] ?? [];
            $cloneErrors = $result['errors'] ?? [];
            $warnings = $inbudget['warnings'] ?? [];
            $unrouted = $inbudget['unrouted'] ?? [];
            $infoCount = $inbudget['infoCount'] ?? null;
            $linkCount = $inbudget['linkCount'] ?? null;
        @endphp

        @if ($inbudget['running'] ?? false)
            <div class="notice mt-6 border-info/30">
                <span class="chip-dot mt-1.5 text-info" data-ping aria-hidden="true"></span>
                <span class="text-info">Abgleich läuft…</span>
            </div>
        @endif

        @php
            $stats = [];
            if ($inbudget['lastSuccessAt'] ?? null) {
                $stats[] = ['Zuletzt', $fmtDate($inbudget['lastSuccessAt']), null];
                if ($inbudget['lastFullSyncAt'] ?? null) {
                    $stats[] = ['Vollständig', $fmtDate($inbudget['lastFullSyncAt']), null];
                }
                if (isset($inbudget['lastFetch']['requests'])) {
                    $stats[] = ['Letzter Abruf', (['full' => 'vollständig', 'changes' => 'nur Änderungen', 'none' => 'lokal'][$inbudget['lastFetch']['mode']] ?? '').', '.$inbudget['lastFetch']['requests'].' Anfragen', null];
                }
                $stats[] = ['Aktive Projekte', $inbudget['projectCount'] ?? 0, null];
                $stats[] = ['Repositories', count($inbudget['repos'] ?? $inbudget['repositories'] ?? []), null];
            }
            if ($infoCount !== null) {
                $stats[] = ['Infos', $infoCount.(($inbudget['matchedInfoCount'] ?? null) !== null ? ' ('.$inbudget['matchedInfoCount'].' bei aktiven Projekten)' : ''), null];
            }
            if (($inbudget['resourceRepoCount'] ?? null) !== null) {
                $stats[] = ['Repos aus Kunden-Ressourcen', $inbudget['resourceRepoCount'], null];
            }
            if ($linkCount !== null) {
                $stats[] = ['Erkannte Links', $linkCount, $infoCount && $linkCount === 0 ? 'text-warning' : null];
            }
            foreach (['added' => 'Neu', 'updated' => 'Geändert', 'reactivated' => 'Wieder aktiv', 'deactivated' => 'Deaktiviert'] as $key => $label) {
                if (! empty($result[$key])) {
                    $stats[] = [$label, count($result[$key]), 'text-success'];
                }
            }
        @endphp
        @if ($stats)
            <dl class="stats mt-6 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" data-inbudget-stats>
                @foreach ($stats as [$label, $value, $tone])
                    <div class="stat"><dt class="label">{{ $label }}</dt><dd class="stat-value {{ $tone }}">{{ $value }}</dd></div>
                @endforeach
                @for ($i = count($stats) % 5; $i > 0 && $i < 5; $i++)
                    <div class="stat hidden lg:block" aria-hidden="true"></div>
                @endfor
            </dl>
        @elseif (! ($inbudget['running'] ?? false) && ! ($inbudget['error'] ?? null))
            <p class="muted mt-6 text-sm">Noch nicht abgeglichen.</p>
        @endif

        @if ($inbudget['error'] ?? null)
            <div class="notice mt-4 border-warning/30">
                <span class="notice-dot text-warning" aria-hidden="true"></span>
                <span>Letzter Abgleich fehlgeschlagen: {{ $inbudget['error'] }}</span>
            </div>
        @endif

        @php
            $sections = [
                ['clone', count($cloneErrors) === 1 ? '1 Repository konnte nicht geklont werden' : count($cloneErrors).' Repositories konnten nicht geklont werden', 'Hat der Bot-Account Zugriff auf das Repository?', array_map(fn ($e) => [$e['repository'] ?? '', $e['message'] ?? ''], $cloneErrors), 'text-danger', 'Nicht geklont'],
                ['warnings', count($warnings).' Projekte mit Links, die nyrus nicht nutzen kann', 'Zum Beispiel ein Git-Link, der nicht auf GitHub zeigt, oder ein Jira-/ClickUp-Link ohne Repository.', array_map(fn ($w) => [$w['project'] ?? '', $w['message'] ?? ''], $warnings), 'text-warning', 'Links unbrauchbar'],
                ['unrouted', count($unrouted).' Projekte mit Repository, aber ohne Jira- oder ClickUp-Link', isset($inbudget['repos']) ? 'Diese Repositories stehen in der Projektliste (Filter «Ohne Jira/ClickUp»); dort kannst du Jira-Projekt oder ClickUp-Liste ergänzen.' : 'Hinterlege den Link in inBudget.', array_map(fn ($p) => [$p, ''], $unrouted), 'text-white/60', 'Ohne Jira/ClickUp'],
            ];
            $sections = array_values(array_filter($sections, fn ($s) => count($s[3]) > 0));
        @endphp

        @if (count($sections) > 1)
            <nav class="mt-8 flex flex-wrap gap-2" aria-label="Hinweise">
                @foreach ($sections as [$id, , , $items, $tone, $short])
                    <a href="#report-{{ $id }}" class="chip chip-tag h-8 gap-2 px-3 text-sm hover:border-white/30"><span class="chip-dot {{ $tone }}"></span>{{ $short }} <span class="count">{{ count($items) }}</span></a>
                @endforeach
            </nav>
        @endif

        @foreach ($sections as [$id, $title, $hint, $items, $tone, $short])
            <section class="card mt-6 overflow-hidden" id="report-{{ $id }}" data-filter-scope data-report="{{ $id }}">
                <div class="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
                    <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-current/25 bg-current/10 {{ $tone }}"><x-icon :name="$id === 'unrouted' ? 'list' : 'warning'" /></span>
                    <div class="min-w-0 flex-1 basis-64">
                        <h2 @class(['text-base', '!text-danger' => $id === 'clone'])>{{ $title }}</h2>
                        <p class="muted mt-0.5 text-sm">{{ $hint }}</p>
                    </div>
                    @if (count($items) > 8)
                        <div class="flex w-full items-center gap-3 sm:w-auto">
                            <span class="count shrink-0" data-filter-count title="Treffer">{{ count($items) }}</span>
                            <label class="search w-full sm:w-64">
                                <x-icon name="search" />
                                <input type="search" placeholder="Liste filtern…" aria-label="Liste filtern" data-filter-input class="input" @if ($id === 'unrouted') data-hotkey-search @endif>
                            </label>
                        </div>
                    @endif
                </div>
                <ul @class(['divided text-sm', 'scroll-area max-h-[26rem]' => count($items) > 8]) @if (count($items) > 8) data-scroll-area @endif>
                    @foreach ($items as [$label, $message])
                        @php
                            $number = preg_match('/^(P-\d+)\s+(.*)$/', $label, $m) ? $m : null;
                        @endphp
                        <li class="flex gap-x-4 px-4 py-2.5 break-words transition-colors hover:bg-white/[0.03] sm:px-5" data-filter-item>
                            @if ($number)
                                <span class="w-16 shrink-0 font-mono text-xs leading-5 text-white/45">{{ $number[1] }}</span>
                                <span class="min-w-0 text-white/85">{{ $number[2] }}</span>
                            @else
                                <span class="min-w-0"><span class="text-white/90">{{ $label }}</span>@if ($message !== '')<span class="mt-0.5 block font-mono text-xs text-white/50">{{ $message }}</span>@endif</span>
                            @endif
                        </li>
                    @endforeach
                </ul>
                <p class="muted hidden px-5 py-6 text-center text-sm" data-filter-empty>Keine Treffer.</p>
            </section>
        @endforeach

        @if (! count($cloneErrors) && ! count($warnings) && ! count($unrouted) && ! ($inbudget['error'] ?? null))
            <div class="card mt-8 flex items-center gap-3 px-5 py-4 text-sm">
                <x-icon name="check" class="size-5 text-success" />
                <span class="text-white/80">Keine Hinweise vom letzten Abgleich.</span>
            </div>
        @endif
    @endif
</x-app>
