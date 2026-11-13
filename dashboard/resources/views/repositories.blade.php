<x-app title="Repositories">
    <p class="eyebrow">Konfiguration</p>
    <h1 class="mt-2 text-5xl">Repositories</h1>
    <p class="mt-1 text-sm text-graphite">Woran nyrus arbeitet und welche Tickets in welches Repository gehen. Änderungen übernimmt nyrus ohne Neustart.</p>

    @if ($error)
        <div class="mt-6 rounded-2xl bg-warning px-4 py-3 text-sm font-bold">Konfiguration konnte nicht geladen werden: {{ $error }}</div>
    @endif

    <div class="mt-6 space-y-4">
        @forelse ($repositories as $repo)
            @php($name = $repo['name'] ?? $repo['id'])
            <details class="card" @if (old('_repo') === $name) open @endif>
                <summary class="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                    <span class="font-medium">{{ $name }}</span>
                    @if (($repo['isActive'] ?? true) === false)
                        <span class="bg-gold-light rounded-full px-2 py-0.5 text-xs font-bold text-graphite">inaktiv</span>
                    @endif
                    <span class="text-sm text-graphite">{{ $repo['baseBranch'] ?? 'main' }}</span>
                    @if ($repo['githubUrl'] ?? null)
                        <a href="{{ $repo['githubUrl'] }}" target="_blank" rel="noopener" class="ml-auto text-sm link">GitHub</a>
                    @endif
                </summary>
                <div class="border-t border-ink/10 px-4 py-4">
                    <form method="POST" action="{{ route('repositories.update', $name) }}" class="grid gap-4 sm:grid-cols-2">
                        @csrf
                        @method('PUT')
                        <input type="hidden" name="_repo" value="{{ $name }}">
                        <label class="text-sm">Basis-Branch
                            <input name="baseBranch" value="{{ $repo['baseBranch'] ?? 'main' }}" class="field">
                        </label>
                        <label class="text-sm">Projekte (kommagetrennt)
                            <input name="projectKeys" value="{{ implode(', ', $repo['projectKeys'] ?? []) }}" class="field">
                        </label>
                        <label class="text-sm">Team-Keys (kommagetrennt)
                            <input name="teamKeys" value="{{ implode(', ', $repo['teamKeys'] ?? []) }}" class="field">
                        </label>
                        <label class="text-sm">Routing-Labels (kommagetrennt)
                            <input name="routingLabels" value="{{ implode(', ', $repo['routingLabels'] ?? []) }}" class="field">
                        </label>
                        <label class="flex items-center gap-2 text-sm">
                            <input type="hidden" name="isActive" value="0">
                            <input type="checkbox" name="isActive" value="1" @checked($repo['isActive'] ?? true)> aktiv
                        </label>
                        <div class="text-xs text-graphite sm:col-span-2">Pfad: <span class="font-mono">{{ $repo['repositoryPath'] ?? '–' }}</span></div>
                        <div class="flex flex-wrap gap-2 sm:col-span-2">
                            <button class="btn">Routing speichern</button>
                        </div>
                    </form>
                    <form method="POST" action="{{ route('repositories.destroy', $name) }}" class="mt-4 flex flex-wrap items-center gap-3 border-t border-ink/10 pt-4"
                          onsubmit="return confirm('{{ $name }} aus nyrus entfernen?')">
                        @csrf
                        @method('DELETE')
                        <label class="flex items-center gap-2 text-sm text-graphite">
                            <input type="checkbox" name="deleteFiles" value="1"> auch den Klon auf dem Server löschen
                        </label>
                        <button class="btn-danger">Entfernen</button>
                    </form>
                </div>
            </details>
        @empty
            <p class="border border-dashed border-ink/30 rounded-2xl bg-white px-4 py-8 text-center text-sm text-graphite">Noch keine Repositories.</p>
        @endforelse
    </div>

    <h2 class="mt-10 text-2xl font-extrabold">Repository hinzufügen</h2>
    <p class="mt-1 text-sm text-graphite">nyrus klont das Repository auf dem Server (über <span class="font-mono">gh</span>, der Bot-Account braucht Zugriff). Das kann einen Moment dauern.</p>
    <form method="POST" action="{{ route('repositories.store') }}" class="mt-4 grid gap-4 card p-4 sm:grid-cols-2">
        @csrf
        <label class="text-sm sm:col-span-2">Git-URL
            <input name="repository_url" value="{{ old('repository_url') }}" required placeholder="https://github.com/teamnovu/projekt.git" class="field">
        </label>
        <label class="text-sm">Name (optional, sonst aus der URL)
            <input name="name" value="{{ old('name') }}" class="field">
        </label>
        <label class="text-sm">Basis-Branch
            <input name="baseBranch" value="{{ old('baseBranch', 'main') }}" class="field">
        </label>
        <label class="text-sm">Projekte (kommagetrennt)
            <input name="projectKeys" value="{{ old('projectKeys') }}" class="field">
        </label>
        <label class="text-sm">Routing-Labels (kommagetrennt)
            <input name="routingLabels" value="{{ old('routingLabels') }}" class="field">
        </label>
        <div class="sm:col-span-2">
            <button class="btn">Hinzufügen</button>
        </div>
    </form>
</x-app>
