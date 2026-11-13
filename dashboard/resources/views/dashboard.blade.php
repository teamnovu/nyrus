<x-app title="Übersicht">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <p class="eyebrow">nyrus</p>
            <h1 class="mt-2 text-3xl">Übersicht</h1>
            <p class="mt-1 text-sm text-brand-gray-dark">Zustand von nyrus und alle Sessions, die neueste zuerst.</p>
        </div>
        <a href="{{ route('dashboard') }}" class="btn-secondary">Aktualisieren</a>
    </div>

    <div class="mt-8 grid grid-cols-2 gap-px border border-black/10 bg-black/10 md:grid-cols-5">
        <div class="col-span-2 bg-black p-5 text-white md:col-span-1">
            <div class="label !text-white/60">nyrus</div>
            <div class="mt-2 flex items-center gap-2">
                <x-status-badge :status="$health['state']" class="text-sm" />
                @if ($health['version'])
                    <span class="text-sm text-white/60">v{{ $health['version'] }}</span>
                @endif
            </div>
            @if ($health['state'] === 'down')
                <p class="mt-2 text-sm text-red-300">Prozess antwortet nicht. Daemon in Forge prüfen.</p>
            @endif
        </div>
        @foreach ([['Sessions', $counts['total']], ['Laufen', $counts['active']], ['Warten auf Antwort', $counts['awaiting']], ['Fehler', $counts['error']]] as [$label, $value])
            <div class="bg-white p-5">
                <div class="label">{{ $label }}</div>
                <div class="mt-1 text-4xl font-bold">{{ $value }}</div>
            </div>
        @endforeach
    </div>

    @if ($error)
        <div class="mt-6 border-l-4 border-gold-800 bg-white px-4 py-3 text-sm">Sessions konnten nicht geladen werden: {{ $error }}</div>
    @endif

    <div class="mt-6 overflow-x-auto card">
        <table class="w-full min-w-[720px] text-left text-sm">
            <thead class="table-head">
                <tr>
                    <th class="px-4 py-2 font-medium">Ticket</th>
                    <th class="px-4 py-2 font-medium">Status</th>
                    <th class="px-4 py-2 font-medium">Repository</th>
                    <th class="px-4 py-2 font-medium">Zuletzt aktiv</th>
                    <th class="px-4 py-2 font-medium">Pull Request</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-black/5">
                @forelse ($sessions as $session)
                    <tr class="hover:bg-gold-100">
                        <td class="px-4 py-2">
                            <a href="{{ route('sessions.show', $session['id']) }}" class="font-medium text-ink hover:text-brand-gold">
                                {{ $session['issue']['identifier'] ?? $session['id'] }}
                            </a>
                            @if ($session['issue']['title'] ?? null)
                                <div class="text-brand-gray-dark">{{ \Illuminate\Support\Str::limit($session['issue']['title'], 70) }}</div>
                            @endif
                            @if ($session['tracker'] ?? null)
                                <div class="text-xs text-brand-gray-medium">{{ $session['tracker'] }}</div>
                            @endif
                        </td>
                        <td class="px-4 py-2"><x-status-badge :status="$session['status']" /></td>
                        <td class="px-4 py-2 text-brand-gray-dark">{{ collect($session['repositories'])->pluck('id')->filter()->join(', ') ?: '–' }}</td>
                        <td class="px-4 py-2 text-brand-gray-dark">
                            @php($ts = $session['lastActivityAt'] ?? $session['updatedAt'])
                            {{ $ts ? \Illuminate\Support\Carbon::createFromTimestampMs($ts)->timezone('Europe/Zurich')->diffForHumans() : '–' }}
                        </td>
                        <td class="px-4 py-2">
                            @if ($session['pullRequestUrl'])
                                <a href="{{ $session['pullRequestUrl'] }}" target="_blank" rel="noopener" class="link">PR öffnen</a>
                            @else
                                <span class="text-brand-gray-medium">–</span>
                            @endif
                        </td>
                    </tr>
                @empty
                    <tr>
                        <td colspan="5" class="px-4 py-8 text-center text-brand-gray-dark">Noch keine Sessions. Sobald nyrus ein Ticket bearbeitet, erscheint es hier.</td>
                    </tr>
                @endforelse
            </tbody>
        </table>
    </div>
</x-app>
