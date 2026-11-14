<x-app title="inBudget-Abgleich">
    <a href="{{ route('repositories.index', $listQuery) }}" class="link inline-flex items-center gap-1 text-sm" data-back-link>
        <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd"/></svg>
        Alle Projekte
    </a>
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
                <button class="btn" data-busy-label="Gleiche ab…" @disabled($inbudget['running'] ?? false)>Jetzt abgleichen</button>
            </form>
        @endif
    </div>
    <p class="muted mt-2 text-sm">inBudget liefert die Repositories (Git-Link eines Projekts oder Repository einer Ressource seines Kunden) und, falls hinterlegt, das Jira-Projekt oder die ClickUp-Liste dazu. Fehlt etwas, ergänzt du es im jeweiligen Projekt.</p>

    @if (! $inbudget)
        <div class="notice mt-6">
            <span class="notice-dot text-white/40" aria-hidden="true"></span>
            <span>nyrus hat keine inBudget-Anbindung (INBUDGET_URL ist nicht gesetzt) oder ist nicht erreichbar.</span>
        </div>
    @else
        @php($result = $inbudget['result'] ?? [])
        @php($cloneErrors = $result['errors'] ?? [])
        @php($warnings = $inbudget['warnings'] ?? [])
        @php($unrouted = $inbudget['unrouted'] ?? [])
        @php($infoCount = $inbudget['infoCount'] ?? null)
        @php($linkCount = $inbudget['linkCount'] ?? null)

        <div class="card mt-6 flex flex-wrap gap-x-6 gap-y-1 p-4 text-sm sm:px-5">
            @if ($inbudget['running'] ?? false)
                <span class="text-gold">Abgleich läuft…</span>
            @endif
            @if ($inbudget['lastSuccessAt'] ?? null)
                <span class="muted">Zuletzt: {{ \Illuminate\Support\Carbon::parse($inbudget['lastSuccessAt'])->timezone(config('app.timezone'))->format('d.m.Y H:i') }}</span>
                <span class="muted">{{ $inbudget['projectCount'] ?? 0 }} aktive Projekte</span>
                <span class="muted">{{ count($inbudget['repos'] ?? $inbudget['repositories'] ?? []) }} Repositories</span>
            @elseif (! ($inbudget['running'] ?? false) && ! ($inbudget['error'] ?? null))
                <span class="muted">Noch nicht abgeglichen.</span>
            @endif
            @if ($infoCount !== null)
                <span class="muted">{{ $infoCount }} Infos{{ ($inbudget['matchedInfoCount'] ?? null) !== null ? ' ('.$inbudget['matchedInfoCount'].' bei aktiven Projekten)' : '' }}</span>
            @endif
            @if (($inbudget['resourceRepoCount'] ?? null) !== null)
                <span class="muted">{{ $inbudget['resourceRepoCount'] }} Repos aus Kunden-Ressourcen</span>
            @endif
            @if ($linkCount !== null)
                <span @class(['muted' => ! ($infoCount && $linkCount === 0), 'text-warning' => $infoCount && $linkCount === 0])>{{ $linkCount }} erkannte Links</span>
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

        @foreach ([
            ['clone', count($cloneErrors) === 1 ? '1 Repository konnte nicht geklont werden' : count($cloneErrors).' Repositories konnten nicht geklont werden', 'Hat der Bot-Account Zugriff auf das Repository?', array_map(fn ($e) => [$e['repository'] ?? '', $e['message'] ?? ''], $cloneErrors)],
            ['warnings', count($warnings).' Projekte mit Links, die nyrus nicht nutzen kann', 'Zum Beispiel ein Git-Link, der nicht auf GitHub zeigt, oder ein Jira-/ClickUp-Link ohne Repository.', array_map(fn ($w) => [$w['project'] ?? '', $w['message'] ?? ''], $warnings)],
            ['unrouted', count($unrouted).' Projekte mit Repository, aber ohne Jira- oder ClickUp-Link', isset($inbudget['repos']) ? 'Diese Repositories stehen in der Projektliste (Filter «Ohne Jira/ClickUp»); dort kannst du Jira-Projekt oder ClickUp-Liste ergänzen.' : 'Hinterlege den Link in inBudget.', array_map(fn ($p) => [$p, ''], $unrouted)],
        ] as [$id, $title, $hint, $items])
            @if (count($items))
                <section class="mt-8" data-filter-scope data-report="{{ $id }}">
                    <div class="flex flex-wrap items-end gap-3">
                        <div class="min-w-0 flex-1 basis-64">
                            <h2 @class(['text-lg', '!text-warning' => $id === 'clone'])>{{ $title }}</h2>
                            <p class="muted mt-1 text-sm">{{ $hint }}</p>
                        </div>
                        @if (count($items) > 8)
                            <input type="search" placeholder="Suchen…" aria-label="Liste filtern" data-filter-input class="field !mt-0 !h-9 w-full sm:w-64">
                        @endif
                    </div>
                    <ul class="card divided mt-3 max-h-[32rem] overflow-y-auto text-sm">
                        @foreach ($items as [$label, $message])
                            <li class="px-4 py-2 break-words" data-filter-item><span class="text-white/85">{{ $label }}</span>@if ($message !== '')<span class="muted">: {{ $message }}</span>@endif</li>
                        @endforeach
                    </ul>
                    <p class="muted mt-2 hidden text-xs" data-filter-empty>Keine Treffer.</p>
                </section>
            @endif
        @endforeach

        @if (! count($cloneErrors) && ! count($warnings) && ! count($unrouted) && ! ($inbudget['error'] ?? null))
            <p class="muted mt-8 text-sm">Keine Hinweise vom letzten Abgleich.</p>
        @endif
    @endif
</x-app>
