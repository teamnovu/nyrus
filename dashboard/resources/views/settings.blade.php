<x-app title="Einstellungen">
    <h1 class="text-2xl font-semibold">Einstellungen</h1>
    <p class="mt-1 text-sm text-zinc-600">Variablen in der <span class="font-mono">.env</span> von nyrus. Werte werden nie angezeigt, nur überschrieben. nyrus liest die Datei bei Änderungen automatisch neu ein.</p>

    @if ($error)
        <div class="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Einstellungen konnten nicht geladen werden: {{ $error }}</div>
    @endif

    @if ($gh !== null)
        <div class="mt-6 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
            <span class="font-medium">GitHub CLI:</span>
            @if (($gh['isInstalled'] ?? false) && ($gh['isAuthenticated'] ?? false))
                <span class="text-emerald-700">installiert und angemeldet</span>
            @elseif ($gh['isInstalled'] ?? false)
                <span class="text-amber-700">installiert, aber nicht angemeldet (auf dem Server <span class="font-mono">gh auth login</span> ausführen)</span>
            @else
                <span class="text-red-700">nicht installiert</span>
            @endif
        </div>
    @endif

    <div class="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table class="w-full text-left text-sm">
            <thead class="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                <tr><th class="px-4 py-2 font-medium">Variable</th><th class="px-4 py-2 font-medium">Status</th><th class="px-4 py-2 font-medium">Wofür</th></tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
                @php($rows = collect($known)->keys()->merge($set->keys())->unique()->sort()->values())
                @foreach ($rows as $key)
                    <tr>
                        <td class="px-4 py-2 font-mono text-xs">{{ $key }}</td>
                        <td class="px-4 py-2">
                            @if ($set->has($key) && $set[$key]['hasValue'])
                                <span class="text-emerald-700">gesetzt</span>
                            @elseif ($set->has($key))
                                <span class="text-amber-700">leer</span>
                            @else
                                <span class="text-zinc-400">nicht gesetzt</span>
                            @endif
                            @if (in_array($key, $protected, true))
                                <span class="ml-1 text-xs text-zinc-400">(nur auf dem Server)</span>
                            @endif
                        </td>
                        <td class="px-4 py-2 text-zinc-600">{{ $known[$key] ?? '' }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    </div>

    <h2 class="mt-10 text-lg font-semibold">Variable setzen</h2>
    <form method="POST" action="{{ route('settings.update') }}" class="mt-4 grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-3">
        @csrf
        <label class="text-sm">Name
            <input name="key" list="known-keys" value="{{ old('key') }}" required placeholder="GITHUB_TOKEN" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono">
            <datalist id="known-keys">
                @foreach (array_keys($known) as $key)<option value="{{ $key }}">@endforeach
            </datalist>
        </label>
        <label class="text-sm sm:col-span-2">Wert
            <input name="value" type="password" required autocomplete="new-password" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 font-mono">
        </label>
        <div class="sm:col-span-3">
            <button class="rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700">Speichern</button>
            <span class="ml-3 text-xs text-zinc-500">Ins Audit-Log kommt nur der Name, nie der Wert.</span>
        </div>
    </form>
</x-app>
