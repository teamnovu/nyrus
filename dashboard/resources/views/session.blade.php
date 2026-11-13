<x-app :title="$session['issue']['identifier'] ?? 'Session'">
    <a href="{{ route('dashboard') }}" class="text-sm text-zinc-500 hover:text-zinc-900">← Übersicht</a>

    <div class="mt-3 flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold">{{ $session['issue']['identifier'] ?? $session['id'] }}</h1>
        <x-status-badge :status="$session['status']" />
    </div>
    @if ($session['issue']['title'] ?? null)
        <p class="mt-1 text-zinc-600">{{ $session['issue']['title'] }}</p>
    @endif

    <dl class="mt-6 grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-3">
        <div><dt class="text-zinc-500">Tracker</dt><dd>{{ $session['tracker'] ?? '–' }}</dd></div>
        <div><dt class="text-zinc-500">Repository / Branch</dt><dd>
            @forelse ($session['repositories'] as $repo)
                {{ $repo['id'] }}@if ($repo['branch']) <span class="text-zinc-500">({{ $repo['branch'] }})</span>@endif<br>
            @empty
                –
            @endforelse
        </dd></div>
        <div><dt class="text-zinc-500">Pull Request</dt><dd>
            @if ($session['pullRequestUrl'])
                <a href="{{ $session['pullRequestUrl'] }}" target="_blank" rel="noopener" class="break-all text-blue-700 hover:underline">{{ $session['pullRequestUrl'] }}</a>
            @else – @endif
        </dd></div>
        <div><dt class="text-zinc-500">Modell</dt><dd>{{ $session['model'] ?? '–' }}</dd></div>
        <div><dt class="text-zinc-500">Kosten</dt><dd>{{ $session['totalCostUsd'] !== null ? '$'.number_format($session['totalCostUsd'], 2) : '–' }}</dd></div>
        <div><dt class="text-zinc-500">Gestartet</dt><dd>{{ $session['createdAt'] ? \Illuminate\Support\Carbon::createFromTimestampMs($session['createdAt'])->timezone('Europe/Zurich')->format('d.m.Y H:i') : '–' }}</dd></div>
        <div class="sm:col-span-3"><dt class="text-zinc-500">Arbeitsverzeichnis</dt><dd class="break-all font-mono text-xs">{{ $session['workspacePath'] ?? '–' }}</dd></div>
    </dl>

    <h2 class="mt-8 text-lg font-semibold">Verlauf <span class="text-sm font-normal text-zinc-500">({{ count($entries) }} Einträge)</span></h2>
    <ol class="mt-3 space-y-2">
        @forelse ($entries as $entry)
            <li @class([
                'rounded-lg border bg-white p-3 text-sm',
                'border-red-200' => $entry['isError'],
                'border-zinc-200' => ! $entry['isError'],
            ])>
                <div class="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span class="font-medium uppercase">{{ $entry['type'] }}</span>
                    @if ($entry['toolName'])<span class="rounded bg-zinc-100 px-1.5 py-0.5 font-mono">{{ $entry['toolName'] }}</span>@endif
                    @if ($entry['isError'])<span class="text-red-700">Fehler</span>@endif
                    @if ($entry['timestamp'])<span class="ml-auto">{{ \Illuminate\Support\Carbon::createFromTimestampMs($entry['timestamp'])->timezone('Europe/Zurich')->format('H:i:s') }}</span>@endif
                </div>
                <pre class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-zinc-800">{{ $entry['content'] }}</pre>
            </li>
        @empty
            <li class="text-sm text-zinc-500">Noch keine Einträge.</li>
        @endforelse
    </ol>
</x-app>
