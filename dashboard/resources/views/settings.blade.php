<x-app title="Einstellungen">
    <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-0">
            <p class="eyebrow">Konfiguration</p>
            <h1 class="page-title">Einstellungen</h1>
        </div>
        <a href="#set-variable" class="btn ml-auto"><x-icon name="pencil" />Variable setzen</a>
    </div>
    <p class="page-lead">Variablen in der <span class="font-mono text-white/80">.env</span> von nyrus. Werte werden nie angezeigt, nur überschrieben. nyrus liest die Datei bei Änderungen automatisch neu ein.</p>

    @if ($error)
        <div class="notice mt-6 border-warning/30">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>Einstellungen konnten nicht geladen werden: {{ $error }}</span>
        </div>
    @endif

    @if ($gh !== null)
        <div class="card mt-8 flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
            <span class="flex size-8 items-center justify-center rounded-lg border border-line bg-raised"><span class="mark mark-github"></span></span>
            <span class="font-medium text-white">GitHub CLI</span>
            @if (($gh['isInstalled'] ?? false) && ($gh['isAuthenticated'] ?? false))
                <span class="chip chip-status text-success"><span class="chip-dot"></span>installiert und angemeldet</span>
            @elseif ($gh['isInstalled'] ?? false)
                <span class="chip chip-status text-warning"><span class="chip-dot"></span>nicht angemeldet</span>
                <span class="muted">auf dem Server <span class="font-mono text-white/80">gh auth login</span> ausführen</span>
            @else
                <span class="chip chip-status text-danger"><span class="chip-dot"></span>nicht installiert</span>
            @endif
        </div>
    @endif

    @php($rows = collect($known)->keys()->merge($set->keys())->unique()->sort()->values())
    @php($setCount = $rows->filter(fn ($key) => $set->has($key) && $set[$key]['hasValue'])->count())
    <section class="card mt-4 overflow-hidden" data-filter-scope>
        <div class="card-head">
            <h2 class="text-base">Variablen</h2>
            <span class="text-xs text-white/50 tabular-nums">{{ $setCount }} von {{ $rows->count() }} gesetzt</span>
            <label class="search ml-auto w-full sm:w-64">
                <x-icon name="search" />
                <input type="search" placeholder="Variable suchen…" aria-label="Variablen filtern" data-filter-input data-hotkey-search class="input !h-8">
                <span class="kbd">/</span>
            </label>
        </div>
        <div class="divided">
            @foreach ($rows as $key)
                @php($isSet = $set->has($key) && $set[$key]['hasValue'])
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-white/[0.025]" data-filter-item>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="truncate font-mono text-sm text-white">{{ $key }}</span>
                            @if (in_array($key, $protected, true))
                                <span class="chip chip-meta text-white/50">nur auf dem Server</span>
                            @endif
                        </div>
                        @if ($known[$key] ?? null)
                            <div class="mt-0.5 text-xs text-white/50">{{ $known[$key] }}</div>
                        @endif
                    </div>
                    @if ($isSet)
                        <span class="chip chip-status text-success"><span class="chip-dot"></span>gesetzt</span>
                    @elseif ($set->has($key))
                        <span class="chip chip-status text-warning"><span class="chip-dot"></span>leer</span>
                    @else
                        <span class="chip chip-status text-white/45"><span class="chip-dot opacity-60"></span>nicht gesetzt</span>
                    @endif
                </div>
            @endforeach
        </div>
        <p class="muted hidden px-5 py-6 text-center text-sm" data-filter-empty>Keine Variable passt.</p>
    </section>

    <div class="card mt-8 scroll-mt-24 p-5 sm:p-6" id="set-variable">
        <h2 class="text-lg">Variable setzen</h2>
        <p class="muted mt-1 text-sm">Überschreibt den Wert in der <span class="font-mono">.env</span>. Ins Audit-Log kommt nur der Name, nie der Wert.</p>
        <form method="POST" action="{{ route('settings.update') }}" class="mt-5 grid gap-4 sm:grid-cols-3">
            @csrf
            <label class="label">Name
                <input name="key" list="known-keys" value="{{ old('key') }}" required placeholder="GITHUB_TOKEN" class="field font-mono">
                <datalist id="known-keys">
                    @foreach (array_keys($known) as $key)<option value="{{ $key }}">@endforeach
                </datalist>
            </label>
            <label class="label sm:col-span-2">Wert
                <input name="value" type="password" required autocomplete="new-password" class="field font-mono">
            </label>
            <div class="flex flex-wrap items-center gap-4 sm:col-span-3">
                <button class="btn">Speichern</button>
            </div>
        </form>
    </div>
</x-app>
