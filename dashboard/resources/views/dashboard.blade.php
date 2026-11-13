<x-app title="Übersicht">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <h1 class="text-2xl font-semibold">Übersicht</h1>
            <p class="mt-1 text-sm text-zinc-600">Zustand von nyrus und alle Sessions, die neueste zuerst.</p>
        </div>
        <a href="{{ route('dashboard') }}" class="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100">Aktualisieren</a>
    </div>

    <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div class="rounded-lg border border-zinc-200 bg-white p-4 lg:col-span-2">
            <div class="text-sm text-zinc-500">nyrus</div>
            <div class="mt-2 flex items-center gap-2">
                <x-status-badge :status="$health['state']" class="text-sm" />
                @if ($health['version'])
                    <span class="text-sm text-zinc-500">Version {{ $health['version'] }}</span>
                @endif
            </div>
            @if ($health['state'] === 'down')
                <p class="mt-2 text-sm text-red-700">Prozess antwortet nicht. Daemon in Forge prüfen.</p>
            @endif
        </div>
        @foreach ([['Sessions', $counts['total']], ['Laufen', $counts['active']], ['Warten auf Antwort', $counts['awaiting']], ['Fehler', $counts['error']]] as [$label, $value])
            <div class="rounded-lg border border-zinc-200 bg-white p-4">
                <div class="text-sm text-zinc-500">{{ $label }}</div>
                <div class="mt-1 text-2xl font-semibold">{{ $value }}</div>
            </div>
        @endforeach
    </div>

    @if ($error)
        <div class="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Sessions konnten nicht geladen werden: {{ $error }}</div>
    @endif

    <div class="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table class="w-full min-w-[720px] text-left text-sm">
            <thead class="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                <tr>
                    <th class="px-4 py-2 font-medium">Ticket</th>
                    <th class="px-4 py-2 font-medium">Status</th>
                    <th class="px-4 py-2 font-medium">Repository</th>
                    <th class="px-4 py-2 font-medium">Zuletzt aktiv</th>
                    <th class="px-4 py-2 font-medium">Pull Request</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
                @forelse ($sessions as $session)
                    <tr class="hover:bg-zinc-50">
                        <td class="px-4 py-2">
                            <a href="{{ route('sessions.show', $session['id']) }}" class="font-medium text-zinc-900 hover:underline">
                                {{ $session['issue']['identifier'] ?? $session['id'] }}
                            </a>
                            @if ($session['issue']['title'] ?? null)
                                <div class="text-zinc-500">{{ \Illuminate\Support\Str::limit($session['issue']['title'], 70) }}</div>
                            @endif
                            @if ($session['tracker'] ?? null)
                                <div class="text-xs text-zinc-400">{{ $session['tracker'] }}</div>
                            @endif
                        </td>
                        <td class="px-4 py-2"><x-status-badge :status="$session['status']" /></td>
                        <td class="px-4 py-2 text-zinc-600">{{ collect($session['repositories'])->pluck('id')->filter()->join(', ') ?: '–' }}</td>
                        <td class="px-4 py-2 text-zinc-600">
                            @php($ts = $session['lastActivityAt'] ?? $session['updatedAt'])
                            {{ $ts ? \Illuminate\Support\Carbon::createFromTimestampMs($ts)->timezone('Europe/Zurich')->diffForHumans() : '–' }}
                        </td>
                        <td class="px-4 py-2">
                            @if ($session['pullRequestUrl'])
                                <a href="{{ $session['pullRequestUrl'] }}" target="_blank" rel="noopener" class="text-blue-700 hover:underline">PR öffnen</a>
                            @else
                                <span class="text-zinc-400">–</span>
                            @endif
                        </td>
                    </tr>
                @empty
                    <tr>
                        <td colspan="5" class="px-4 py-8 text-center text-zinc-500">Noch keine Sessions. Sobald nyrus ein Ticket bearbeitet, erscheint es hier.</td>
                    </tr>
                @endforelse
            </tbody>
        </table>
    </div>
</x-app>
