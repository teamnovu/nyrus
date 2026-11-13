<x-app title="Repositories">
    <p class="eyebrow">Konfiguration</p>
    <h1 class="mt-2 text-3xl">Repositories</h1>
    <p class="mt-1 text-sm text-brand-gray-dark">Woran nyrus arbeitet und welche Tickets in welches Repository gehen. Änderungen übernimmt nyrus ohne Neustart.</p>

    @if ($error)
        <div class="mt-6 border-l-4 border-gold-800 bg-white px-4 py-3 text-sm">Konfiguration konnte nicht geladen werden: {{ $error }}</div>
    @endif

    <div class="mt-6 space-y-4">
        @forelse ($repositories as $repo)
            @php($name = $repo['name'] ?? $repo['id'])
            <details class="card" @if (old('_repo') === $name) open @endif>
                <summary class="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                    <span class="font-medium">{{ $name }}</span>
                    @if (($repo['isActive'] ?? true) === false)
                        <span class="bg-gold-200 px-2 py-0.5 text-xs text-brand-gray-dark uppercase tracking-wider">inaktiv</span>
                    @endif
                    <span class="text-sm text-brand-gray-dark">{{ $repo['baseBranch'] ?? 'main' }}</span>
                    @if ($repo['githubUrl'] ?? null)
                        <a href="{{ $repo['githubUrl'] }}" target="_blank" rel="noopener" class="ml-auto text-sm link">GitHub</a>
                    @endif
                </summary>
                <div class="border-t border-black/5 px-4 py-4">
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
                        <div class="text-xs text-brand-gray-dark sm:col-span-2">Pfad: <span class="font-mono">{{ $repo['repositoryPath'] ?? '–' }}</span></div>
                        <div class="flex flex-wrap gap-2 sm:col-span-2">
                            <button class="btn">Routing speichern</button>
                        </div>
                    </form>
                    <form method="POST" action="{{ route('repositories.destroy', $name) }}" class="mt-4 flex flex-wrap items-center gap-3 border-t border-black/5 pt-4"
                          onsubmit="return confirm('{{ $name }} aus nyrus entfernen?')">
                        @csrf
                        @method('DELETE')
                        <label class="flex items-center gap-2 text-sm text-brand-gray-dark">
                            <input type="checkbox" name="deleteFiles" value="1"> auch den Klon auf dem Server löschen
                        </label>
                        <button class="btn-danger">Entfernen</button>
                    </form>
                </div>
            </details>
        @empty
            <p class="border border-dashed border-black/20 bg-white px-4 py-8 text-center text-sm text-brand-gray-dark">Noch keine Repositories.</p>
        @endforelse
    </div>

    <h2 class="mt-10 text-lg font-bold tracking-wide uppercase">Repository hinzufügen</h2>
    <p class="mt-1 text-sm text-brand-gray-dark">nyrus klont das Repository auf dem Server (über <span class="font-mono">gh</span>, der Bot-Account braucht Zugriff). Das kann einen Moment dauern.</p>
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
