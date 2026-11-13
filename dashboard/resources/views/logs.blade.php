<x-app title="Logs">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <p class="eyebrow">Betrieb</p>
            <h1 class="mt-3 text-5xl sm:text-6xl">Logs</h1>
            <p class="muted mt-2 text-sm">
                Die letzten Zeilen aus dem Log des nyrus-Daemons.
                @if ($path)
                    Datei: <span class="font-mono">{{ $path }}</span>
                @endif
            </p>
        </div>
        <form method="GET" class="glass-strong flex flex-wrap items-center gap-1 rounded-full p-1.5 text-sm">
            @foreach (['' => 'Alle', 'INFO' => 'Info', 'WARN' => 'Warn', 'ERROR' => 'Error'] as $value => $text)
                <button name="level" value="{{ $value }}"
                        @class([
                            'rounded-full px-4 py-1.5 font-bold transition duration-300',
                            'bg-white/15 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]' => $level === $value,
                            'text-white/60 hover:text-white' => $level !== $value,
                        ])>{{ $text }}</button>
            @endforeach
            <select name="lines" onchange="this.form.submit()" class="rounded-full bg-transparent px-3 py-1.5 font-bold text-white/70 outline-none">
                @foreach ([100, 300, 1000, 2000] as $option)
                    <option value="{{ $option }}" @selected($lines === $option) class="bg-ink">{{ $option }} Zeilen</option>
                @endforeach
            </select>
        </form>
    </div>

    @if ($error)
        <div class="notice mt-6">
            <span class="chip bg-peach/20 text-peach"><span class="chip-dot"></span></span>
            <span>{{ $error }}</span>
        </div>
    @else
        <div class="glass mt-8 overflow-hidden">
            <div class="flex items-center gap-2 px-5 pt-4">
                <span class="size-3 rounded-full bg-coral/80"></span>
                <span class="size-3 rounded-full bg-peach/80"></span>
                <span class="size-3 rounded-full bg-brand/80"></span>
                <span class="muted ml-3 text-xs">{{ count($entries) }} Zeilen</span>
            </div>
            <pre class="max-h-[70vh] overflow-auto p-5 font-mono text-xs leading-relaxed text-white/80">@forelse ($entries as $line)<span @class(['text-coral' => str_contains($line, '[ERROR'), 'text-peach' => str_contains($line, '[WARN')])>{{ $line }}</span>
@empty<span class="text-white/40">Keine Einträge.</span>@endforelse</pre>
        </div>
    @endif
</x-app>
