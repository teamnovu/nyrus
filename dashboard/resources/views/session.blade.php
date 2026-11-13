<x-app :title="$session['issue']['identifier'] ?? 'Session'">
    <a href="{{ route('dashboard') }}" class="text-sm font-bold text-graphite hover:text-ink">← Übersicht</a>

    <p class="eyebrow mt-6">Session</p>
    <div class="mt-2 flex flex-wrap items-center gap-3">
        <h1 class="text-5xl">{{ $session['issue']['identifier'] ?? $session['id'] }}</h1>
        <x-status-badge :status="$session['status']" />
    </div>
    @if ($session['issue']['title'] ?? null)
        <p class="mt-1 text-graphite">{{ $session['issue']['title'] }}</p>
    @endif

    <dl class="mt-6 grid gap-4 card p-5 text-sm sm:grid-cols-3">
        <div><dt class="label">Tracker</dt><dd>{{ $session['tracker'] ?? '–' }}</dd></div>
        <div><dt class="label">Repository / Branch</dt><dd>
            @forelse ($session['repositories'] as $repo)
                {{ $repo['id'] }}@if ($repo['branch']) <span class="text-graphite">({{ $repo['branch'] }})</span>@endif<br>
            @empty
                –
            @endforelse
        </dd></div>
        <div><dt class="label">Pull Request</dt><dd>
            @if ($session['pullRequestUrl'])
                <a href="{{ $session['pullRequestUrl'] }}" target="_blank" rel="noopener" class="break-all link">{{ $session['pullRequestUrl'] }}</a>
            @else – @endif
        </dd></div>
        <div><dt class="label">Modell</dt><dd>{{ $session['model'] ?? '–' }}</dd></div>
        <div><dt class="label">Kosten</dt><dd>{{ $session['totalCostUsd'] !== null ? '$'.number_format($session['totalCostUsd'], 2) : '–' }}</dd></div>
        <div><dt class="label">Gestartet</dt><dd>{{ $session['createdAt'] ? \Illuminate\Support\Carbon::createFromTimestampMs($session['createdAt'])->timezone('Europe/Zurich')->format('d.m.Y H:i') : '–' }}</dd></div>
        <div class="sm:col-span-3"><dt class="label">Arbeitsverzeichnis</dt><dd class="break-all font-mono text-xs">{{ $session['workspacePath'] ?? '–' }}</dd></div>
    </dl>

    <h2 class="mt-8 text-2xl font-extrabold">Verlauf <span class="text-sm font-normal text-graphite">({{ count($entries) }} Einträge)</span></h2>
    <ol class="mt-3 space-y-2">
        @forelse ($entries as $entry)
            <li @class([
                'border-l-4 bg-white p-3 text-sm',
                'border-danger' => $entry['isError'],
                'border-gold' => ! $entry['isError'],
            ])>
                <div class="flex flex-wrap items-center gap-2 text-xs text-graphite">
                    <span class="font-bold">{{ $entry['type'] }}</span>
                    @if ($entry['toolName'])<span class="bg-gold-light px-1.5 py-0.5 font-mono">{{ $entry['toolName'] }}</span>@endif
                    @if ($entry['isError'])<span class="text-danger">Fehler</span>@endif
                    @if ($entry['timestamp'])<span class="ml-auto">{{ \Illuminate\Support\Carbon::createFromTimestampMs($entry['timestamp'])->timezone('Europe/Zurich')->format('H:i:s') }}</span>@endif
                </div>
                <pre class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ink">{{ $entry['content'] }}</pre>
            </li>
        @empty
            <li class="text-sm text-graphite">Noch keine Einträge.</li>
        @endforelse
    </ol>
</x-app>
