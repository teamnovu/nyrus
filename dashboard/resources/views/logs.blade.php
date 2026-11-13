<x-app title="Logs">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <p class="eyebrow">Betrieb</p>
            <h1 class="mt-2 text-5xl">Logs</h1>
            <p class="mt-1 text-sm text-graphite">
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
        <div class="mt-6 rounded-2xl bg-warning px-4 py-3 text-sm font-bold">{{ $error }}</div>
    @else
        <pre class="mt-6 max-h-[70vh] overflow-auto rounded-2xl bg-ink p-5 font-mono text-xs leading-relaxed text-gold-light">@forelse ($entries as $line)<span @class(['text-red-400' => str_contains($line, '[ERROR'), 'text-warning' => str_contains($line, '[WARN')])>{{ $line }}</span>
@empty<span class="text-graphite">Keine Einträge.</span>@endforelse</pre>
    @endif
</x-app>
