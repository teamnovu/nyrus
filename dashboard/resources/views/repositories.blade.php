<x-app title="Repositories">
    <h1 class="text-2xl font-semibold">Repositories</h1>
    <p class="mt-1 text-sm text-zinc-600">Woran nyrus arbeitet und welche Tickets in welches Repository gehen. Änderungen übernimmt nyrus ohne Neustart.</p>

    @if ($error)
        <div class="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Konfiguration konnte nicht geladen werden: {{ $error }}</div>
    @endif

    <div class="mt-6 space-y-4">
        @forelse ($repositories as $repo)
            @php($name = $repo['name'] ?? $repo['id'])
            <details class="rounded-lg border border-zinc-200 bg-white" @if (old('_repo') === $name) open @endif>
                <summary class="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                    <span class="font-medium">{{ $name }}</span>
                    @if (($repo['isActive'] ?? true) === false)
                        <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">inaktiv</span>
                    @endif
                    <span class="text-sm text-zinc-500">{{ $repo['baseBranch'] ?? 'main' }}</span>
                    @if ($repo['githubUrl'] ?? null)
                        <a href="{{ $repo['githubUrl'] }}" target="_blank" rel="noopener" class="ml-auto text-sm text-blue-700 hover:underline">GitHub</a>
                    @endif
                </summary>
                <div class="border-t border-zinc-100 px-4 py-4">
                    <form method="POST" action="{{ route('repositories.update', $name) }}" class="grid gap-4 sm:grid-cols-2">
                        @csrf
                        @method('PUT')
                        <input type="hidden" name="_repo" value="{{ $name }}">
                        <label class="text-sm">Basis-Branch
                            <input name="baseBranch" value="{{ $repo['baseBranch'] ?? 'main' }}" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5">
                        </label>
                        <label class="text-sm">Projekte (kommagetrennt)
                            <input name="projectKeys" value="{{ implode(', ', $repo['projectKeys'] ?? []) }}" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5">
                        </label>
                        <label class="text-sm">Team-Keys (kommagetrennt)
                            <input name="teamKeys" value="{{ implode(', ', $repo['teamKeys'] ?? []) }}" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5">
                        </label>
                        <label class="text-sm">Routing-Labels (kommagetrennt)
                            <input name="routingLabels" value="{{ implode(', ', $repo['routingLabels'] ?? []) }}" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5">
                        </label>
                        <label class="flex items-center gap-2 text-sm">
                            <input type="hidden" name="isActive" value="0">
                            <input type="checkbox" name="isActive" value="1" @checked($repo['isActive'] ?? true)> aktiv
                        </label>
                        <div class="text-xs text-zinc-500 sm:col-span-2">Pfad: <span class="font-mono">{{ $repo['repositoryPath'] ?? '–' }}</span></div>
                        <div class="flex flex-wrap gap-2 sm:col-span-2">
                            <button class="rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700">Routing speichern</button>
                        </div>
                    </form>
                    <form method="POST" action="{{ route('repositories.destroy', $name) }}" class="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4"
                          onsubmit="return confirm('{{ $name }} aus nyrus entfernen?')">
                        @csrf
                        @method('DELETE')
                        <label class="flex items-center gap-2 text-sm text-zinc-600">
                            <input type="checkbox" name="deleteFiles" value="1"> auch den Klon auf dem Server löschen
                        </label>
                        <button class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Entfernen</button>
                    </form>
                </div>
            </details>
        @empty
            <p class="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">Noch keine Repositories.</p>
        @endforelse
    </div>

    <h2 class="mt-10 text-lg font-semibold">Repository hinzufügen</h2>
    <p class="mt-1 text-sm text-zinc-600">nyrus klont das Repository auf dem Server (über <span class="font-mono">gh</span>, der Bot-Account braucht Zugriff). Das kann einen Moment dauern.</p>
    <form method="POST" action="{{ route('repositories.store') }}" class="mt-4 grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2">
        @csrf
        <label class="text-sm sm:col-span-2">Git-URL
            <input name="repository_url" value="{{ old('repository_url') }}" required placeholder="https://github.com/teamnovu/projekt.git" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5">
        </label>
        <label class="text-sm">Name (optional, sonst aus der URL)
            <input name="name" value="{{ old('name') }}" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5">
        </label>
        <label class="text-sm">Basis-Branch
            <input name="baseBranch" value="{{ old('baseBranch', 'main') }}" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5">
        </label>
        <label class="text-sm">Projekte (kommagetrennt)
            <input name="projectKeys" value="{{ old('projectKeys') }}" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5">
        </label>
        <label class="text-sm">Routing-Labels (kommagetrennt)
            <input name="routingLabels" value="{{ old('routingLabels') }}" class="mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5">
        </label>
        <div class="sm:col-span-2">
            <button class="rounded-md bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700">Hinzufügen</button>
        </div>
    </form>
</x-app>
