<x-app title="Logs">
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div class="min-w-0">
            <p class="eyebrow">Betrieb</p>
            <h1 class="page-title">Logs</h1>
        </div>
        <p class="muted min-w-0 text-sm break-all">
            Log des nyrus-Daemons, live.
            @if ($path)
                <span class="font-mono text-xs text-white/45">{{ $path }}</span>
            @endif
        </p>
    </div>

    @if ($error)
        <div class="notice mt-6 border-warning/30">
            <span class="notice-dot text-warning" aria-hidden="true"></span>
            <span>{{ $error }}</span>
        </div>
    @else
        {{-- a window of its own: toolbar on top, lines scroll inside, status at the bottom --}}
        <div class="log-view card relative mt-6 flex h-[calc(100dvh-14rem)] min-h-[26rem] flex-col overflow-hidden" data-log-view data-wrap="true"
             data-tail-url="{{ route('logs.tail', ['level' => $level, 'lines' => $lines], false) }}" data-offset="{{ $offset }}" data-lines="{{ $lines }}">
            <form method="GET" class="card-head !gap-2 text-sm">
                <div class="segmented" role="group" aria-label="Level">
                    @foreach (['' => 'Alle', 'INFO' => 'Info', 'WARN' => 'Warn', 'ERROR' => 'Error'] as $value => $text)
                        <button name="level" value="{{ $value }}" aria-pressed="{{ $level === $value ? 'true' : 'false' }}" class="flex items-center gap-1.5">
                            @if ($value === 'WARN')<span class="size-1.5 rounded-full bg-warning"></span>@elseif ($value === 'ERROR')<span class="size-1.5 rounded-full bg-danger"></span>@elseif ($value === 'INFO')<span class="size-1.5 rounded-full bg-info"></span>@endif
                            {{ $text }}
                        </button>
                    @endforeach
                </div>
                <select name="lines" onchange="this.form.submit()" aria-label="Anzahl Zeilen" class="select">
                    @foreach ([100, 300, 1000, 2000] as $option)
                        <option value="{{ $option }}" @selected($lines === $option)>{{ $option }} Zeilen</option>
                    @endforeach
                </select>
                <label class="search w-full sm:w-64">
                    <x-icon name="search" />
                    <input type="search" placeholder="Im Log suchen…" aria-label="Im Log suchen" data-log-search data-hotkey-search class="input">
                    <span class="kbd">/</span>
                </label>
                <div class="ml-auto flex items-center gap-2">
                    <button type="button" class="btn-ghost !h-9 !px-2.5" data-log-wrap aria-pressed="true" title="Lange Zeilen umbrechen">
                        <x-icon name="wrap" class="size-4 text-white/60" /><span class="hidden lg:inline">Umbrechen</span>
                    </button>
                    <button type="button" class="btn-ghost !h-9" data-log-live aria-pressed="true">
                        <span class="size-2 rounded-full bg-success" data-log-live-dot></span><span data-log-live-label>Live</span>
                    </button>
                </div>
            </form>

            <div class="relative min-h-0 flex-1">
                <div class="h-full overflow-y-auto overscroll-contain bg-inset py-2 font-mono text-[12.5px] leading-6" data-log-scroll>
                    <div data-log-lines>
                        @include('partials.log-lines', ['entries' => $entries])
                    </div>
                    <p @class(['muted px-5 py-10 text-center font-sans text-sm', 'hidden' => count($entries) > 0]) data-log-empty>Keine Einträge.</p>
                </div>
                <button type="button" hidden data-log-jump
                        class="btn absolute right-4 bottom-4 z-10 shadow-[0_8px_30px_rgb(0_0_0/0.6)]">
                    <x-icon name="arrow-down" />
                    <span data-log-jump-label>Zum Ende</span>
                </button>
            </div>

            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-raised px-4 py-2 text-xs text-white/50 sm:px-5">
                <span class="tabular-nums" data-log-count>{{ count($entries) }} Zeilen</span>
                <span class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-warning"></span>Warnung</span>
                <span class="flex items-center gap-1.5"><span class="size-1.5 rounded-full bg-danger"></span>Fehler</span>
                <span class="ml-auto hidden sm:inline">Neue Zeilen alle 2 s · folgt dem Ende, solange du unten bist</span>
            </div>
        </div>
    @endif
</x-app>
