<x-app title="Übersicht">
    <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
            <p class="eyebrow">nyrus</p>
            <h1 class="mt-2 text-5xl">Übersicht</h1>
            <p class="mt-1 text-sm text-brown-light">Zustand von nyrus und alle Sessions, die neueste zuerst.</p>
        </div>
        <a href="{{ route('dashboard') }}" class="btn-secondary">Aktualisieren</a>
    </div>

    <div class="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div class="col-span-2 rounded-2xl bg-ink p-5 text-white md:col-span-1">
            <div class="label !text-white/60">nyrus</div>
            <div class="mt-2 flex items-center gap-2">
                <x-status-badge :status="$health['state']" class="text-sm" />
                @if ($health['version'])
                    <span class="text-sm text-white/60">v{{ $health['version'] }}</span>
                @endif
            </div>
            @if ($health['state'] === 'down')
                <p class="mt-2 text-sm text-coral">Prozess antwortet nicht. Daemon in Forge prüfen.</p>
            @endif
        </div>
        @foreach ([['Sessions', $counts['total']], ['Laufen', $counts['active']], ['Warten auf Antwort', $counts['awaiting']], ['Fehler', $counts['error']]] as [$label, $value])
            <div class="card p-5">
                <div class="label">{{ $label }}</div>
                <div class="mt-1 text-5xl font-extrabold">{{ $value }}</div>
            </div>
        @endforeach
    </div>

    @if ($error)
        <div class="mt-6 rounded-2xl bg-peach px-4 py-3 text-sm font-bold">Sessions konnten nicht geladen werden: {{ $error }}</div>
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
            <tbody class="divide-y divide-ink/10">
                @forelse ($sessions as $session)
                    <tr class="hover:bg-brand-muted">
                        <td class="px-4 py-2">
                            <a href="{{ route('sessions.show', $session['id']) }}" class="font-medium text-ink hover:text-brand-strong">
                                {{ $session['issue']['identifier'] ?? $session['id'] }}
                            </a>
                            @if ($session['issue']['title'] ?? null)
                                <div class="text-brown-light">{{ \Illuminate\Support\Str::limit($session['issue']['title'], 70) }}</div>
                            @endif
                            @if ($session['tracker'] ?? null)
                                <div class="text-xs text-subtle">{{ $session['tracker'] }}</div>
                            @endif
                        </td>
                        <td class="px-4 py-2"><x-status-badge :status="$session['status']" /></td>
                        <td class="px-4 py-2 text-brown-light">{{ collect($session['repositories'])->pluck('id')->filter()->join(', ') ?: '–' }}</td>
                        <td class="px-4 py-2 text-brown-light">
                            @php($ts = $session['lastActivityAt'] ?? $session['updatedAt'])
                            {{ $ts ? \Illuminate\Support\Carbon::createFromTimestampMs($ts)->timezone('Europe/Zurich')->diffForHumans() : '–' }}
                        </td>
                        <td class="px-4 py-2">
                            @if ($session['pullRequestUrl'])
                                <a href="{{ $session['pullRequestUrl'] }}" target="_blank" rel="noopener" class="link">PR öffnen</a>
                            @else
                                <span class="text-subtle">–</span>
                            @endif
                        </td>
                    </tr>
                @empty
                    <tr>
                        <td colspan="5" class="px-4 py-8 text-center text-brown-light">Noch keine Sessions. Sobald nyrus ein Ticket bearbeitet, erscheint es hier.</td>
                    </tr>
                @endforelse
            </tbody>
        </table>
    </div>
</x-app>
