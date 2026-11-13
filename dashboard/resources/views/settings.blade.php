<x-app title="Einstellungen">
    <p class="eyebrow">Konfiguration</p>
    <h1 class="page-title">Einstellungen</h1>
    <p class="muted mt-2 text-sm">Variablen in der <span class="font-mono">.env</span> von nyrus. Werte werden nie angezeigt, nur überschrieben. nyrus liest die Datei bei Änderungen automatisch neu ein.</p>

    @if ($error)
        <div class="notice mt-6">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>Einstellungen konnten nicht geladen werden: {{ $error }}</span>
        </div>
    @endif

    @if ($gh !== null)
        <div class="card mt-8 flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
            <span class="font-medium text-white">GitHub CLI</span>
            @if (($gh['isInstalled'] ?? false) && ($gh['isAuthenticated'] ?? false))
                <span class="chip text-gold"><span class="chip-dot"></span>installiert und angemeldet</span>
            @elseif ($gh['isInstalled'] ?? false)
                <span class="chip text-warning"><span class="chip-dot"></span>nicht angemeldet</span>
                <span class="muted">auf dem Server <span class="font-mono text-white/80">gh auth login</span> ausführen</span>
            @else
                <span class="chip text-danger"><span class="chip-dot"></span>nicht installiert</span>
            @endif
        </div>
    @endif

    @php($rows = collect($known)->keys()->merge($set->keys())->unique()->sort()->values())
    <div class="card divided mt-4 overflow-hidden">
        @foreach ($rows as $key)
            @php($isSet = $set->has($key) && $set[$key]['hasValue'])
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="truncate font-mono text-sm text-white">{{ $key }}</span>
                        @if (in_array($key, $protected, true))
                            <span class="chip text-white/40">nur auf dem Server</span>
                        @endif
                    </div>
                    @if ($known[$key] ?? null)
                        <div class="muted mt-0.5 text-xs">{{ $known[$key] }}</div>
                    @endif
                </div>
                @if ($isSet)
                    <span class="chip text-gold"><span class="chip-dot"></span>gesetzt</span>
                @elseif ($set->has($key))
                    <span class="chip text-warning"><span class="chip-dot"></span>leer</span>
                @else
                    <span class="chip text-white/40"><span class="chip-dot"></span>nicht gesetzt</span>
                @endif
            </div>
        @endforeach
    </div>

    <div class="card mt-10 p-5 sm:p-6">
        <h2 class="text-lg">Variable setzen</h2>
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
                <span class="muted text-xs">Ins Audit-Log kommt nur der Name, nie der Wert.</span>
            </div>
        </form>
    </div>
</x-app>
