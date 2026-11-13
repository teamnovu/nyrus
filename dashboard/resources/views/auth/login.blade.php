<x-app title="Anmelden">
    <div class="mx-auto mt-24 max-w-sm rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <h1 class="text-xl font-semibold">nyrus Dashboard</h1>
        <p class="mt-2 text-sm text-zinc-600">Anmelden mit deinem Google-Konto (@{{ $domain }}).</p>
        <a href="{{ route('auth.google') }}"
           class="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700">
            Mit Google anmelden
        </a>
        @if ($devLogin)
            <form method="POST" action="{{ route('auth.dev') }}" class="mt-3">
                @csrf
                <button class="w-full rounded-md border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50">Lokal ohne Google anmelden (nur Entwicklung)</button>
            </form>
        @endif
    </div>
</x-app>
