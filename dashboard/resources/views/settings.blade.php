<x-app title="Einstellungen">
    <p class="eyebrow">Konfiguration</p>
    <h1 class="mt-2 text-5xl">Einstellungen</h1>
    <p class="mt-1 text-sm text-brown-light">Variablen in der <span class="font-mono">.env</span> von nyrus. Werte werden nie angezeigt, nur überschrieben. nyrus liest die Datei bei Änderungen automatisch neu ein.</p>

    @if ($error)
        <div class="mt-6 rounded-2xl bg-peach px-4 py-3 text-sm font-bold">Einstellungen konnten nicht geladen werden: {{ $error }}</div>
    @endif

    @if ($gh !== null)
        <div class="mt-6 card p-4 text-sm">
            <span class="font-medium">GitHub CLI:</span>
            @if (($gh['isInstalled'] ?? false) && ($gh['isAuthenticated'] ?? false))
                <span class="text-brand-strong font-medium">installiert und angemeldet</span>
            @elseif ($gh['isInstalled'] ?? false)
                <span class="text-brown">installiert, aber nicht angemeldet (auf dem Server <span class="font-mono">gh auth login</span> ausführen)</span>
            @else
                <span class="text-coral">nicht installiert</span>
            @endif
        </div>
    @endif

    <div class="mt-6 overflow-x-auto card">
        <table class="w-full text-left text-sm">
            <thead class="table-head">
                <tr><th class="px-4 py-2 font-medium">Variable</th><th class="px-4 py-2 font-medium">Status</th><th class="px-4 py-2 font-medium">Wofür</th></tr>
            </thead>
            <tbody class="divide-y divide-ink/10">
                @php($rows = collect($known)->keys()->merge($set->keys())->unique()->sort()->values())
                @foreach ($rows as $key)
                    <tr>
                        <td class="px-4 py-2 font-mono text-xs">{{ $key }}</td>
                        <td class="px-4 py-2">
                            @if ($set->has($key) && $set[$key]['hasValue'])
                                <span class="text-brand-strong font-medium">gesetzt</span>
                            @elseif ($set->has($key))
                                <span class="text-brown">leer</span>
                            @else
                                <span class="text-subtle">nicht gesetzt</span>
                            @endif
                            @if (in_array($key, $protected, true))
                                <span class="ml-1 text-xs text-subtle">(nur auf dem Server)</span>
                            @endif
                        </td>
                        <td class="px-4 py-2 text-brown-light">{{ $known[$key] ?? '' }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    </div>

    <h2 class="mt-10 text-2xl font-extrabold">Variable setzen</h2>
    <form method="POST" action="{{ route('settings.update') }}" class="mt-4 grid gap-4 card p-4 sm:grid-cols-3">
        @csrf
        <label class="text-sm">Name
            <input name="key" list="known-keys" value="{{ old('key') }}" required placeholder="GITHUB_TOKEN" class="field font-mono">
            <datalist id="known-keys">
                @foreach (array_keys($known) as $key)<option value="{{ $key }}">@endforeach
            </datalist>
        </label>
        <label class="text-sm sm:col-span-2">Wert
            <input name="value" type="password" required autocomplete="new-password" class="field font-mono">
        </label>
        <div class="sm:col-span-3">
            <button class="btn">Speichern</button>
            <span class="ml-3 text-xs text-brown-light">Ins Audit-Log kommt nur der Name, nie der Wert.</span>
        </div>
    </form>
</x-app>
