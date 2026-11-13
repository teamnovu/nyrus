<x-app title="Einstellungen">
    <p class="eyebrow">Konfiguration</p>
    <h1 class="mt-2 text-3xl">Einstellungen</h1>
    <p class="mt-1 text-sm text-brand-gray-dark">Variablen in der <span class="font-mono">.env</span> von nyrus. Werte werden nie angezeigt, nur überschrieben. nyrus liest die Datei bei Änderungen automatisch neu ein.</p>

    @if ($error)
        <div class="mt-6 border-l-4 border-gold-800 bg-white px-4 py-3 text-sm">Einstellungen konnten nicht geladen werden: {{ $error }}</div>
    @endif

    @if ($gh !== null)
        <div class="mt-6 card p-4 text-sm">
            <span class="font-medium">GitHub CLI:</span>
            @if (($gh['isInstalled'] ?? false) && ($gh['isAuthenticated'] ?? false))
                <span class="text-brand-gold font-medium">installiert und angemeldet</span>
            @elseif ($gh['isInstalled'] ?? false)
                <span class="text-gold-900">installiert, aber nicht angemeldet (auf dem Server <span class="font-mono">gh auth login</span> ausführen)</span>
            @else
                <span class="text-red-700">nicht installiert</span>
            @endif
        </div>
    @endif

    <div class="mt-6 overflow-x-auto card">
        <table class="w-full text-left text-sm">
            <thead class="table-head">
                <tr><th class="px-4 py-2 font-medium">Variable</th><th class="px-4 py-2 font-medium">Status</th><th class="px-4 py-2 font-medium">Wofür</th></tr>
            </thead>
            <tbody class="divide-y divide-black/5">
                @php($rows = collect($known)->keys()->merge($set->keys())->unique()->sort()->values())
                @foreach ($rows as $key)
                    <tr>
                        <td class="px-4 py-2 font-mono text-xs">{{ $key }}</td>
                        <td class="px-4 py-2">
                            @if ($set->has($key) && $set[$key]['hasValue'])
                                <span class="text-brand-gold font-medium">gesetzt</span>
                            @elseif ($set->has($key))
                                <span class="text-gold-900">leer</span>
                            @else
                                <span class="text-brand-gray-medium">nicht gesetzt</span>
                            @endif
                            @if (in_array($key, $protected, true))
                                <span class="ml-1 text-xs text-brand-gray-medium">(nur auf dem Server)</span>
                            @endif
                        </td>
                        <td class="px-4 py-2 text-brand-gray-dark">{{ $known[$key] ?? '' }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    </div>

    <h2 class="mt-10 text-lg font-bold tracking-wide uppercase">Variable setzen</h2>
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
            <span class="ml-3 text-xs text-brand-gray-dark">Ins Audit-Log kommt nur der Name, nie der Wert.</span>
        </div>
    </form>
</x-app>
