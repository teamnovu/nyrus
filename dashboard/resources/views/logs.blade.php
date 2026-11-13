<x-app title="Logs">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <p class="eyebrow">Betrieb</p>
            <h1 class="mt-2 text-3xl">Logs</h1>
            <p class="mt-1 text-sm text-brand-gray-dark">
                Die letzten Zeilen aus dem Log des nyrus-Daemons.
                @if ($path)
                    Datei: <span class="font-mono">{{ $path }}</span>
                @endif
            </p>
        </div>
        <form method="GET" class="flex flex-wrap items-center gap-2 text-sm">
            <select name="level" class="field !mt-0 !w-auto !py-1.5">
                <option value="">alle Level</option>
                @foreach (['INFO', 'WARN', 'ERROR', 'DEBUG'] as $option)
                    <option value="{{ $option }}" @selected($level === $option)>{{ $option }}</option>
                @endforeach
            </select>
            <select name="lines" class="field !mt-0 !w-auto !py-1.5">
                @foreach ([100, 300, 1000, 2000] as $option)
                    <option value="{{ $option }}" @selected($lines === $option)>{{ $option }} Zeilen</option>
                @endforeach
            </select>
            <button class="btn-secondary">Anzeigen</button>
        </form>
    </div>

    @if ($error)
        <div class="mt-6 border-l-4 border-gold-800 bg-white px-4 py-3 text-sm">{{ $error }}</div>
    @else
        <pre class="mt-6 max-h-[70vh] overflow-auto bg-black p-5 font-mono text-xs leading-relaxed text-gold-100">@forelse ($entries as $line)<span @class(['text-red-400' => str_contains($line, '[ERROR'), 'text-gold-600' => str_contains($line, '[WARN')])>{{ $line }}</span>
@empty<span class="text-brand-gray-dark">Keine Einträge.</span>@endforelse</pre>
    @endif
</x-app>
