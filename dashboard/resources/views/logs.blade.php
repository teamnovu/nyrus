<x-app title="Logs">
    <p class="eyebrow">Betrieb</p>
    <h1 class="page-title">Logs</h1>
    <p class="muted mt-2 text-sm break-all">
        Log des nyrus-Daemons, live.
        @if ($path)
            <span class="font-mono text-xs">{{ $path }}</span>
        @endif
    </p>

    @if ($error)
        <div class="notice mt-6">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>{{ $error }}</span>
        </div>
    @else
        <div class="mt-8" data-log-view data-tail-url="{{ route('logs.tail', ['level' => $level, 'lines' => $lines], false) }}" data-offset="{{ $offset }}" data-lines="{{ $lines }}">
            {{-- toolbar: stays on top while scrolling through the log --}}
            <div class="z-20 -mx-4 bg-canvas/90 px-4 py-3 backdrop-blur-md sm:sticky sm:top-14 sm:-mx-6 sm:px-6">
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
                    <select name="lines" onchange="this.form.submit()" aria-label="Anzahl Zeilen" class="h-9 rounded-lg bg-canvas px-2.5 text-white/75 ring-1 ring-white/10 outline-none ring-inset">
                        @foreach ([100, 300, 1000, 2000] as $option)
                            <option value="{{ $option }}" @selected($lines === $option)>{{ $option }} Zeilen</option>
                        @endforeach
                    </select>
                    <input type="search" placeholder="Suchen…" aria-label="Im Log suchen" data-log-search
                           class="h-9 w-full min-w-0 rounded-lg bg-canvas px-3 text-white ring-1 ring-white/10 outline-none ring-inset placeholder:text-white/25 focus:ring-gold/60 sm:w-56">
                    <div class="ml-auto flex items-center gap-3">
                        <span class="muted text-xs tabular-nums" data-log-count>{{ count($entries) }} Zeilen</span>
                        <button type="button" class="btn-ghost !h-9" data-log-live aria-pressed="true">
                            <span class="size-2 rounded-full bg-gold" data-log-live-dot></span><span data-log-live-label>Live</span>
                        </button>
                    </div>
                </form>
            </div>

            <div class="card mt-1 overflow-hidden">
                <div class="py-3 font-mono text-[12.5px] leading-6" data-log-lines>
                    @include('partials.log-lines', ['entries' => $entries])
                </div>
                <p @class(['muted px-5 pb-5 text-sm', 'hidden' => count($entries) > 0]) data-log-empty>Keine Einträge.</p>
            </div>

            <button type="button" hidden data-log-jump
                    class="btn fixed right-4 bottom-6 z-30 shadow-[0_8px_30px_rgb(0_0_0/0.6)] sm:right-8">
                <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v10.638l3.96-4.158a.75.75 0 1 1 1.08 1.04l-5.25 5.5a.75.75 0 0 1-1.08 0l-5.25-5.5a.75.75 0 1 1 1.08-1.04l3.96 4.158V3.75A.75.75 0 0 1 10 3Z" clip-rule="evenodd"/></svg>
                <span data-log-jump-label>Zum Ende</span>
            </button>
        </div>
    @endif
</x-app>
