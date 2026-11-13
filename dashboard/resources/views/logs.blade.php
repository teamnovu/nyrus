<x-app title="Logs">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <h1 class="text-2xl font-semibold">Logs</h1>
            <p class="mt-1 text-sm text-zinc-600">
                Die letzten Zeilen aus dem Log des nyrus-Daemons.
                @if ($path)
                    Datei: <span class="font-mono">{{ $path }}</span>
                @endif
            </p>
        </div>
        <form method="GET" class="flex flex-wrap items-center gap-2 text-sm">
            <select name="level" class="rounded-md border border-zinc-300 bg-white px-2 py-1.5">
                <option value="">alle Level</option>
                @foreach (['INFO', 'WARN', 'ERROR', 'DEBUG'] as $option)
                    <option value="{{ $option }}" @selected($level === $option)>{{ $option }}</option>
                @endforeach
            </select>
            <select name="lines" class="rounded-md border border-zinc-300 bg-white px-2 py-1.5">
                @foreach ([100, 300, 1000, 2000] as $option)
                    <option value="{{ $option }}" @selected($lines === $option)>{{ $option }} Zeilen</option>
                @endforeach
            </select>
            <button class="rounded-md border border-zinc-300 bg-white px-3 py-1.5 hover:bg-zinc-100">Anzeigen</button>
        </form>
    </div>

    @if ($error)
        <div class="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{{ $error }}</div>
    @else
        <pre class="mt-6 max-h-[70vh] overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">@forelse ($entries as $line)<span @class(['text-red-400' => str_contains($line, '[ERROR'), 'text-amber-300' => str_contains($line, '[WARN')])>{{ $line }}</span>
@empty<span class="text-zinc-500">Keine Einträge.</span>@endforelse</pre>
    @endif
</x-app>
