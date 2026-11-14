@php
    $heading = \App\Services\SessionList::heading($session);
    $subtitle = \App\Services\SessionList::subtitle($session);
    $items = \App\Services\SessionTimeline::items($entries);
    $pr = $session['pullRequestUrl'] ?? null;
    $fmt = fn ($ms) => $ms ? \Illuminate\Support\Carbon::createFromTimestampMs($ms)->timezone('Europe/Zurich')->format('d.m.Y H:i') : '–';
    $time = fn ($ms) => $ms ? \Illuminate\Support\Carbon::createFromTimestampMs($ms)->timezone('Europe/Zurich')->format('H:i:s') : null;
    $num = fn ($n) => number_format($n, 0, '.', "'");
    $duration = function ($ms) {
        if ($ms === null) {
            return '–';
        }
        $s = intdiv((int) $ms, 1000);
        return $s >= 3600
            ? sprintf('%d h %02d min', intdiv($s, 3600), intdiv($s % 3600, 60))
            : sprintf('%d min %02d s', intdiv($s, 60), $s % 60);
    };
    $kinds = [
        'prompt' => ['Auftrag', 'user', 'text-gold'],
        'text' => ['nyrus', 'sparkles', 'text-white/70'],
        'tool' => ['Werkzeug', 'wrench', 'text-info'],
        'output' => ['Ausgabe', 'output', 'text-white/50'],
        'result' => ['Ergebnis', 'flag', 'text-success'],
        'other' => [null, 'info', 'text-white/50'],
    ];
    $markdown = fn (string $text) => \Illuminate\Support\Str::markdown($text, ['html_input' => 'escape', 'allow_unsafe_links' => false]);
@endphp
<x-app :title="$heading">
    {{-- back link and actions stay on top; the title joins them once scrolled past --}}
    <div class="sticky-bar -mt-3" data-sticky>
        <div class="flex h-12 items-center gap-3">
            <a href="{{ route('dashboard') }}" class="back-link shrink-0"><x-icon name="chevron-left" />Übersicht</a>
            <div class="sticky-title flex items-center gap-2 border-l border-line pl-3 text-sm" aria-hidden="true">
                <span class="truncate">{{ $heading }}</span>
                <x-status-badge :status="$session['status'] ?? 'unknown'" class="hidden sm:inline-flex" />
            </div>
            @if ($pr)
                <a href="{{ $pr }}" target="_blank" rel="noopener" class="btn-ghost ml-auto !h-8 shrink-0"><x-icon name="pull" class="size-4 text-success" />{{ preg_match('~/pull/(\d+)~', $pr, $m) ? 'PR #'.$m[1] : 'Pull Request' }}<x-icon name="external" class="size-3.5 text-white/40" /></a>
            @endif
        </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
        <h1 class="text-3xl sm:text-[2.5rem] sm:leading-tight">{{ $heading }}</h1>
        <x-status-badge :status="$session['status'] ?? 'unknown'" />
    </div>
    @if ($subtitle)
        <p class="mt-2 text-lg text-white/65">{{ $subtitle }}</p>
    @endif

    <dl class="stats mt-8 sm:grid-cols-2 lg:grid-cols-4">
        <div class="stat"><dt class="label">Quelle</dt><dd class="stat-value">{{ \App\Services\SessionList::sourceLabel(\App\Services\SessionList::source($session)) }}@if ($session['parentSessionId'] ?? null) <a href="{{ route('sessions.show', $session['parentSessionId']) }}" class="link ml-1 text-xs font-normal">Teil einer Session</a>@endif</dd></div>
        <div class="stat"><dt class="label">Repository / Branch</dt><dd class="stat-value">
            @forelse ($session['repositories'] ?? [] as $repo)
                <div class="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span>{{ $repo['id'] }}</span>
                    @if ($repo['branch'])
                        <button type="button" class="group inline-flex min-w-0 items-center gap-1 font-mono text-xs font-normal text-white/55 hover:text-white" data-copy="{{ $repo['branch'] }}" title="Branch kopieren">
                            <x-icon name="branch" class="size-3.5 text-white/35" /><span class="truncate">{{ $repo['branch'] }}</span><x-icon name="copy" class="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                    @endif
                </div>
            @empty
                –
            @endforelse
        </dd></div>
        <div class="stat"><dt class="label">Modell</dt><dd class="stat-value">{{ \App\Services\SessionList::engine($session) ?? '–' }}</dd></div>
        <div class="stat"><dt class="label">Kosten</dt><dd class="stat-value text-base">{{ ($session['totalCostUsd'] ?? null) !== null ? '$'.number_format($session['totalCostUsd'], 2) : '–' }}</dd></div>
        <div class="stat"><dt class="label">Gestartet</dt><dd class="stat-value">{{ $fmt($session['createdAt'] ?? null) }}</dd></div>
        <div class="stat"><dt class="label">Laufzeit</dt><dd class="stat-value text-base">{{ $duration($session['runtimeMs'] ?? null) }}@if (($session['runs'] ?? 0) > 1) <span class="ml-1 text-xs font-normal text-white/50">{{ $session['runs'] }} Läufe</span>@endif</dd></div>
        <div class="stat sm:col-span-2">
            <dt class="label">Tokens</dt>
            <dd class="stat-value">
                @if ($session['tokens'] ?? null)
                    <span class="text-base">{{ $num($session['tokens']['total']) }}</span>
                    <span class="ml-1 text-xs font-normal text-white/50">in {{ $num($session['tokens']['input']) }} · out {{ $num($session['tokens']['output']) }} · Cache {{ $num($session['tokens']['cacheRead'] + $session['tokens']['cacheCreation']) }}</span>
                @else <span class="font-normal text-white/50">– (nach dem ersten Lauf)</span> @endif
            </dd>
        </div>
        <div class="stat sm:col-span-2 lg:col-span-4">
            <dt class="label">Pull Request</dt>
            <dd class="stat-value truncate font-normal">
                @if ($pr)
                    <a href="{{ $pr }}" target="_blank" rel="noopener" class="link">{{ $pr }}</a>
                @else <span class="text-white/50">–</span> @endif
            </dd>
        </div>
        <div class="stat sm:col-span-2 lg:col-span-4">
            <dt class="label">Arbeitsverzeichnis</dt>
            <dd class="mt-1 flex min-w-0 items-center gap-2">
                <span class="min-w-0 font-mono text-xs break-all text-white/70">{{ $session['workspacePath'] ?? '–' }}</span>
                @if ($session['workspacePath'] ?? null)
                    <button type="button" class="btn-icon !size-7 shrink-0" data-copy="{{ $session['workspacePath'] }}" title="Pfad kopieren" aria-label="Pfad kopieren"><x-icon name="copy" class="size-3.5" /></button>
                @endif
            </dd>
        </div>
    </dl>

    <div class="mt-12 flex flex-wrap items-center gap-3">
        <h2 class="section-title">Verlauf <span class="count">{{ count($entries) }}</span></h2>
        @if ($items)
            <div class="ml-auto flex items-center gap-2 text-xs text-white/50">
                @php($toolCount = collect($items)->where('kind', 'tool')->count())
                @php($errorCount = collect($items)->where('isError', true)->count())
                <span>{{ $toolCount }} {{ $toolCount === 1 ? 'Werkzeugaufruf' : 'Werkzeugaufrufe' }}</span>
                @if ($errorCount)<span class="chip chip-status text-danger"><span class="chip-dot"></span>{{ $errorCount }} {{ $errorCount === 1 ? 'Fehler' : 'Fehler' }}</span>@endif
                <button type="button" class="btn-ghost !h-8" data-expand-all>Alle aufklappen</button>
            </div>
        @endif
    </div>

    @if ($items)
        <ol class="timeline mt-5 space-y-5">
            @foreach ($items as $item)
                @php([$kindLabel, $icon, $iconColor] = $kinds[$item['kind']])
                <li class="timeline-item" data-entry-kind="{{ $item['kind'] }}">
                    <span @class(['timeline-icon', $iconColor => ! $item['isError'], 'border-danger/50 text-danger' => $item['isError'], 'border-success/40 bg-success/10' => $item['kind'] === 'result', 'border-gold/40 bg-gold/10' => $item['kind'] === 'prompt'])>
                        <x-icon :name="$item['isError'] ? 'warning' : $icon" class="size-4" />
                    </span>
                    <div class="min-w-0 pt-1">
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <span class="font-medium text-white/80">{{ $kindLabel ?? $item['type'] }}</span>
                            @if ($item['kind'] === 'tool')
                                <span class="chip chip-tag !h-5 font-mono">{{ $item['tool'] }}</span>
                            @elseif ($item['kind'] === 'output' && $item['forTool'])
                                <span class="font-mono text-white/40">{{ $item['forTool'] }}</span>
                            @endif
                            @if ($item['isError'])<span class="chip chip-status !h-5 text-danger">Fehler</span>@endif
                            @if ($time($item['timestamp']))<span class="ml-auto font-mono text-white/40 tabular-nums">{{ $time($item['timestamp']) }}</span>@endif
                        </div>

                        @switch($item['kind'])
                            @case('result')
                                <div class="card mt-2.5 border-success/25 p-4 sm:p-5">
                                    <div class="prose-nyrus">{!! $markdown($item['content']) !!}</div>
                                </div>
                                @break
                            @case('prompt')
                            @case('text')
                                <div class="prose-nyrus mt-1.5 {{ $item['kind'] === 'prompt' ? 'rounded-lg border border-gold/20 bg-gold/[0.04] px-4 py-3' : '' }}">{!! $markdown($item['content']) !!}</div>
                                @break
                            @case('tool')
                                <div class="mt-2 space-y-2">
                                    @if ($item['raw'] !== null)
                                        <pre class="code">{{ $item['raw'] }}</pre>
                                    @else
                                        @if ($item['headline'] !== null)
                                            @if ($item['tool'] === 'Bash')
                                                <pre class="code"><span class="text-success select-none">$ </span>{{ $item['headline'] }}</pre>
                                            @else
                                                <div class="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-inset px-3.5 py-2 font-mono text-[12.5px] text-white/85">
                                                    <x-icon :name="in_array($item['tool'], ['Grep', 'Glob', 'WebSearch'], true) ? 'search' : 'document'" class="size-3.5 text-white/35" />
                                                    <span class="min-w-0 break-all">{{ $item['headline'] }}</span>
                                                </div>
                                            @endif
                                        @endif
                                        @if ($item['caption'])
                                            <p class="text-sm text-white/55">{{ $item['caption'] }}</p>
                                        @endif
                                        @if ($item['diff'])
                                            <div class="clamp overflow-hidden rounded-lg border border-line font-mono text-[12.5px] leading-relaxed" data-clamp>
                                                <pre class="border-b border-line bg-danger/[0.07] px-3.5 py-2 break-words whitespace-pre-wrap text-danger/90"><span class="select-none">− </span>{{ $item['diff']['old'] }}</pre>
                                                <pre class="bg-success/[0.06] px-3.5 py-2 break-words whitespace-pre-wrap text-success/90"><span class="select-none">+ </span>{{ $item['diff']['new'] }}</pre>
                                            </div>
                                        @endif
                                        @if ($item['body'] !== null)
                                            <div class="clamp rounded-lg" data-clamp><pre class="code">{{ $item['body'] }}</pre></div>
                                        @endif
                                        @if ($item['fields'])
                                            <dl class="grid gap-x-4 gap-y-1 rounded-lg border border-line bg-inset px-3.5 py-2.5 text-[12.5px] sm:grid-cols-[auto_minmax(0,1fr)]">
                                                @foreach ($item['fields'] as $key => $value)
                                                    <dt class="font-mono text-white/45">{{ $key }}</dt>
                                                    <dd class="min-w-0 font-mono break-words whitespace-pre-wrap text-white/85">{{ $value }}</dd>
                                                @endforeach
                                            </dl>
                                        @endif
                                    @endif
                                </div>
                                @break
                            @default
                                <div class="clamp mt-2 rounded-lg" data-clamp>
                                    <pre @class(['code', 'border-danger/30 bg-danger/[0.05] text-danger/90' => $item['isError']])>{{ $item['content'] }}</pre>
                                </div>
                        @endswitch
                    </div>
                </li>
            @endforeach
        </ol>
    @else
        <div class="card mt-4 flex flex-col items-center px-5 py-12 text-center">
            <x-icon name="inbox" class="size-8 text-white/20" />
            <p class="muted mt-3 text-sm">{{ ($session['live'] ?? true) === false ? 'Verlauf nicht mehr gespeichert.' : 'Noch keine Einträge.' }}</p>
        </div>
    @endif
</x-app>
