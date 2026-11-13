<x-app :title="$session['issue']['identifier'] ?? 'Session'">
    <a href="{{ route('dashboard') }}" class="muted inline-flex items-center gap-1 text-sm transition-colors hover:text-white">
        <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.83 10l3.94 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clip-rule="evenodd"/></svg>
        Übersicht
    </a>

    <div class="mt-6 flex flex-wrap items-center gap-3">
        <h1 class="text-3xl sm:text-4xl">{{ $session['issue']['identifier'] ?? $session['id'] }}</h1>
        <x-status-badge :status="$session['status']" />
    </div>
    @if ($session['issue']['title'] ?? null)
        <p class="muted mt-2">{{ $session['issue']['title'] }}</p>
    @endif

    @php
        $fmt = fn ($ms) => $ms ? \Illuminate\Support\Carbon::createFromTimestampMs($ms)->timezone('Europe/Zurich')->format('d.m.Y H:i') : '–';
        $trackers = ['jira' => 'Jira', 'linear' => 'Linear', 'clickup' => 'ClickUp', 'slack' => 'Slack', 'github' => 'GitHub', 'gitlab' => 'GitLab', 'plane' => 'Plane'];
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
    @endphp
    <dl class="mt-8 grid gap-px overflow-hidden rounded-xl bg-white/[0.07] ring-1 ring-white/[0.07] sm:grid-cols-2 lg:grid-cols-4">
        <div class="bg-surface p-5"><dt class="label">Tracker</dt><dd class="mt-1 text-white">{{ $trackers[$session['tracker'] ?? ''] ?? ($session['tracker'] ?? '–') }}</dd></div>
        <div class="bg-surface p-5"><dt class="label">Repository / Branch</dt><dd class="mt-1 text-white">
            @forelse ($session['repositories'] as $repo)
                {{ $repo['id'] }}@if ($repo['branch']) <span class="muted font-mono text-xs">{{ $repo['branch'] }}</span>@endif<br>
            @empty
                –
            @endforelse
        </dd></div>
        <div class="bg-surface p-5"><dt class="label">Modell</dt><dd class="mt-1 text-white">{{ $session['model'] ?? '–' }}</dd></div>
        <div class="bg-surface p-5"><dt class="label">Kosten</dt><dd class="mt-1 font-semibold tabular-nums text-white">{{ $session['totalCostUsd'] !== null ? '$'.number_format($session['totalCostUsd'], 2) : '–' }}</dd></div>
        <div class="bg-surface p-5"><dt class="label">Gestartet</dt><dd class="mt-1 text-white">{{ $fmt($session['createdAt']) }}</dd></div>
        <div class="bg-surface p-5"><dt class="label">Laufzeit</dt><dd class="mt-1 font-semibold tabular-nums text-white">{{ $duration($session['runtimeMs'] ?? null) }}@if (($session['runs'] ?? 0) > 1) <span class="muted text-xs font-normal">{{ $session['runs'] }} Läufe</span>@endif</dd></div>
        <div class="bg-surface p-5 sm:col-span-2">
            <dt class="label">Tokens</dt>
            <dd class="mt-1 text-white">
                @if ($session['tokens'] ?? null)
                    <span class="font-semibold tabular-nums">{{ $num($session['tokens']['total']) }}</span>
                    <span class="muted text-xs tabular-nums">in {{ $num($session['tokens']['input']) }} · out {{ $num($session['tokens']['output']) }} · Cache {{ $num($session['tokens']['cacheRead'] + $session['tokens']['cacheCreation']) }}</span>
                @else <span class="muted">– (nach dem ersten Lauf)</span> @endif
            </dd>
        </div>
        <div class="bg-surface p-5 sm:col-span-2 lg:col-span-4">
            <dt class="label">Pull Request</dt>
            <dd class="mt-1 truncate">
                @if ($session['pullRequestUrl'])
                    <a href="{{ $session['pullRequestUrl'] }}" target="_blank" rel="noopener" class="link">{{ $session['pullRequestUrl'] }}</a>
                @else <span class="muted">–</span> @endif
            </dd>
        </div>
        <div class="bg-surface p-5 sm:col-span-2 lg:col-span-4"><dt class="label">Arbeitsverzeichnis</dt><dd class="mt-1 break-all font-mono text-xs text-white/65">{{ $session['workspacePath'] ?? '–' }}</dd></div>
    </dl>

    <div class="mt-12 flex items-baseline justify-between">
        <h2 class="text-lg">Verlauf</h2>
        <span class="muted text-xs">{{ count($entries) }} Einträge</span>
    </div>
    <ol class="card divided mt-3 overflow-hidden">
        @forelse ($entries as $entry)
            <li class="px-5 py-4">
                <div class="flex flex-wrap items-center gap-2 text-xs">
                    <span @class(['size-1.5 rounded-full', 'bg-danger' => $entry['isError'], 'bg-gold' => ! $entry['isError']]) aria-hidden="true"></span>
                    <span class="font-medium text-white/75">{{ $entry['type'] }}</span>
                    @if ($entry['toolName'])<span class="font-mono text-white/45">{{ $entry['toolName'] }}</span>@endif
                    @if ($entry['isError'])<span class="chip text-danger">Fehler</span>@endif
                    @if ($entry['timestamp'])<span class="muted ml-auto font-mono tabular-nums">{{ \Illuminate\Support\Carbon::createFromTimestampMs($entry['timestamp'])->timezone('Europe/Zurich')->format('H:i:s') }}</span>@endif
                </div>
                <pre class="mt-2 max-h-80 overflow-auto font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-white/80">{{ $entry['content'] }}</pre>
            </li>
        @empty
            <li class="muted px-5 py-8 text-sm">Noch keine Einträge.</li>
        @endforelse
    </ol>
</x-app>
