<x-app :title="$session['issue']['identifier'] ?? 'Session'">
    <a href="{{ route('dashboard') }}" class="btn-ghost !py-1.5 !pl-3 text-xs">
        <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.83 10l3.94 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clip-rule="evenodd"/></svg>
        Übersicht
    </a>

    <div class="mt-6 flex flex-wrap items-center gap-3">
        <h1 class="text-5xl sm:text-6xl">{{ $session['issue']['identifier'] ?? $session['id'] }}</h1>
        <x-status-badge :status="$session['status']" />
    </div>
    @if ($session['issue']['title'] ?? null)
        <p class="muted mt-2 text-lg">{{ $session['issue']['title'] }}</p>
    @endif

    <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="glass p-5"><div class="label">Tracker</div><div class="mt-1 font-bold text-white">{{ $session['tracker'] ?? '–' }}</div></div>
        <div class="glass p-5"><div class="label">Repository / Branch</div><div class="mt-1 font-bold text-white">
            @forelse ($session['repositories'] as $repo)
                {{ $repo['id'] }}@if ($repo['branch']) <span class="muted font-normal">· {{ $repo['branch'] }}</span>@endif<br>
            @empty
                –
            @endforelse
        </div></div>
        <div class="glass p-5"><div class="label">Modell</div><div class="mt-1 font-bold text-white">{{ $session['model'] ?? '–' }}</div></div>
        <div class="glass p-5"><div class="label">Kosten</div><div class="mt-1 text-2xl font-extrabold tabular-nums text-white">{{ $session['totalCostUsd'] !== null ? '$'.number_format($session['totalCostUsd'], 2) : '–' }}</div></div>
        <div class="glass p-5"><div class="label">Gestartet</div><div class="mt-1 font-bold text-white">{{ $session['createdAt'] ? \Illuminate\Support\Carbon::createFromTimestampMs($session['createdAt'])->timezone('Europe/Zurich')->format('d.m.Y H:i') : '–' }}</div></div>
        <div class="glass p-5 sm:col-span-2 lg:col-span-3">
            <div class="label">Pull Request</div>
            <div class="mt-1 truncate">
                @if ($session['pullRequestUrl'])
                    <a href="{{ $session['pullRequestUrl'] }}" target="_blank" rel="noopener" class="link">{{ $session['pullRequestUrl'] }}</a>
                @else <span class="muted">–</span> @endif
            </div>
        </div>
        <div class="glass p-5 sm:col-span-2 lg:col-span-4"><div class="label">Arbeitsverzeichnis</div><div class="mt-1 break-all font-mono text-xs text-white/70">{{ $session['workspacePath'] ?? '–' }}</div></div>
    </div>

    <div class="mt-10 flex items-baseline justify-between">
        <h2 class="text-2xl">Verlauf</h2>
        <span class="muted text-xs">{{ count($entries) }} Einträge</span>
    </div>
    <ol class="relative mt-4 space-y-3 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[7px] before:w-px before:bg-gradient-to-b before:from-gold/60 before:via-white/10 before:to-transparent">
        @forelse ($entries as $entry)
            <li class="relative">
                <span @class([
                    'absolute top-5 -left-[22px] size-3 rounded-full ring-4 ring-ink',
                    'bg-danger shadow-[0_0_12px_rgb(194_78_56/0.8)]' => $entry['isError'],
                    'bg-gold shadow-[0_0_12px_rgb(213_194_131/0.7)]' => ! $entry['isError'],
                ])></span>
                <div class="glass p-4">
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                        <span class="font-bold text-white/70">{{ $entry['type'] }}</span>
                        @if ($entry['toolName'])<span class="chip bg-white/[0.07] font-mono text-white/70">{{ $entry['toolName'] }}</span>@endif
                        @if ($entry['isError'])<span class="chip bg-danger/20 text-danger">Fehler</span>@endif
                        @if ($entry['timestamp'])<span class="muted ml-auto tabular-nums">{{ \Illuminate\Support\Carbon::createFromTimestampMs($entry['timestamp'])->timezone('Europe/Zurich')->format('H:i:s') }}</span>@endif
                    </div>
                    <pre class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-white/85">{{ $entry['content'] }}</pre>
                </div>
            </li>
        @empty
            <li class="muted text-sm">Noch keine Einträge.</li>
        @endforelse
    </ol>
</x-app>
