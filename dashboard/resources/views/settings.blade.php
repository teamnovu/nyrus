<x-app title="Einstellungen">
    <p class="eyebrow">Konfiguration</p>
    <h1 class="mt-3 text-5xl sm:text-6xl">Einstellungen</h1>
    <p class="muted mt-2 text-sm">Variablen in der <span class="font-mono">.env</span> von nyrus. Werte werden nie angezeigt, nur überschrieben. nyrus liest die Datei bei Änderungen automatisch neu ein.</p>

    @if ($error)
        <div class="notice mt-6">
            <span class="chip bg-warning/20 text-warning"><span class="chip-dot"></span></span>
            <span>Einstellungen konnten nicht geladen werden: {{ $error }}</span>
        </div>
    @endif

    @if ($gh !== null)
        <div class="glass mt-8 flex flex-wrap items-center gap-3 px-6 py-4 text-sm">
            <span class="font-bold text-white">GitHub CLI</span>
            @if (($gh['isInstalled'] ?? false) && ($gh['isAuthenticated'] ?? false))
                <span class="chip bg-gold/15 text-gold"><span class="chip-dot"></span>installiert und angemeldet</span>
            @elseif ($gh['isInstalled'] ?? false)
                <span class="chip bg-warning/20 text-warning"><span class="chip-dot"></span>nicht angemeldet</span>
                <span class="muted">auf dem Server <span class="font-mono text-white/80">gh auth login</span> ausführen</span>
            @else
                <span class="chip bg-danger/20 text-danger"><span class="chip-dot"></span>nicht installiert</span>
            @endif
        </div>
    @endif

    <div class="mt-6 grid gap-3 sm:grid-cols-2">
        @php($rows = collect($known)->keys()->merge($set->keys())->unique()->sort()->values())
        @foreach ($rows as $key)
            @php($isSet = $set->has($key) && $set[$key]['hasValue'])
            <div class="glass flex items-start gap-4 p-5">
                <span @class([
                    'mt-1 size-2.5 shrink-0 rounded-full',
                    'bg-gold shadow-[0_0_10px_rgb(213_194_131/0.8)]' => $isSet,
                    'bg-warning shadow-[0_0_10px_rgb(227_178_107/0.6)]' => ! $isSet && $set->has($key),
                    'bg-white/20' => ! $set->has($key),
                ])></span>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="truncate font-mono text-sm font-bold text-white">{{ $key }}</span>
                        @if (in_array($key, $protected, true))
                            <span class="chip bg-white/[0.07] text-white/50">nur auf dem Server</span>
                        @endif
                    </div>
                    <div class="mt-1 text-xs">
                        @if ($isSet)
                            <span class="font-bold text-gold">gesetzt</span>
                        @elseif ($set->has($key))
                            <span class="font-bold text-warning">leer</span>
                        @else
                            <span class="muted">nicht gesetzt</span>
                        @endif
                        @if ($known[$key] ?? null)
                            <span class="muted"> · {{ $known[$key] }}</span>
                        @endif
                    </div>
                </div>
            </div>
        @endforeach
    </div>

    <div class="glass mt-10 p-6 sm:p-8">
        <h2 class="text-2xl">Variable setzen</h2>
        <form method="POST" action="{{ route('settings.update') }}" class="mt-6 grid gap-4 sm:grid-cols-3">
            @csrf
            <label class="label">Name
                <input name="key" list="known-keys" value="{{ old('key') }}" required placeholder="GITHUB_TOKEN" class="field font-mono font-normal">
                <datalist id="known-keys">
                    @foreach (array_keys($known) as $key)<option value="{{ $key }}">@endforeach
                </datalist>
            </label>
            <label class="label sm:col-span-2">Wert
                <input name="value" type="password" required autocomplete="new-password" class="field font-mono font-normal">
            </label>
            <div class="flex flex-wrap items-center gap-4 sm:col-span-3">
                <button class="btn">Speichern</button>
                <span class="muted text-xs">Ins Audit-Log kommt nur der Name, nie der Wert.</span>
            </div>
        </form>
    </div>
</x-app>
