<x-app title="Logs">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="min-w-0">
            <p class="eyebrow">Betrieb</p>
            <h1 class="page-title">Logs</h1>
            <p class="muted mt-2 text-sm break-all">
                Die letzten Zeilen aus dem Log des nyrus-Daemons.
                @if ($path)
                    <span class="font-mono text-xs">{{ $path }}</span>
                @endif
            </p>
        </div>
        <form method="GET" class="flex flex-wrap items-center gap-2 text-sm">
            <div class="flex rounded-lg p-0.5 ring-1 ring-white/10 ring-inset">
                @foreach (['' => 'Alle', 'INFO' => 'Info', 'WARN' => 'Warn', 'ERROR' => 'Error'] as $value => $text)
                    <button name="level" value="{{ $value }}"
                            @class([
                                'rounded-md px-3 py-1.5 transition-colors duration-150',
                                'bg-white/[0.08] text-white' => $level === $value,
                                'text-white/50 hover:text-white' => $level !== $value,
                            ])>{{ $text }}</button>
                @endforeach
            </div>
            <select name="lines" onchange="this.form.submit()" class="h-9 rounded-lg bg-canvas px-2.5 text-white/75 ring-1 ring-white/10 outline-none ring-inset">
                @foreach ([100, 300, 1000, 2000] as $option)
                    <option value="{{ $option }}" @selected($lines === $option)>{{ $option }} Zeilen</option>
                @endforeach
            </select>
        </form>
    </div>

    @if ($error)
        <div class="notice mt-6">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>{{ $error }}</span>
        </div>
    @else
        <div class="card mt-8 overflow-hidden">
            <div class="flex items-center justify-between border-b border-white/[0.06] px-5 py-2.5 text-xs">
                <span class="font-mono text-white/45">nyrus.log</span>
                <span class="muted">{{ count($entries) }} Zeilen</span>
            </div>
            <pre class="max-h-[70vh] overflow-auto bg-canvas/40 p-5 font-mono text-xs leading-relaxed text-white/75">@forelse ($entries as $line)<span @class(['text-danger' => str_contains($line, '[ERROR'), 'text-warning' => str_contains($line, '[WARN')])>{{ $line }}</span>
@empty<span class="text-white/35">Keine Einträge.</span>@endforelse</pre>
        </div>
    @endif
</x-app>
