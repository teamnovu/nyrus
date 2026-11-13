<x-app title="Anmelden">
    <div class="mx-auto mt-24 max-w-sm rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <h1 class="text-xl font-semibold">nyrus Dashboard</h1>

        @if (request()->has('logout'))
            <p class="mt-2 text-sm text-zinc-600">Du bist abgemeldet.</p>
        @elseif ($failed && ! session('error'))
            <p class="mt-2 text-sm text-red-700">Die Anmeldung über novu SSO hat nicht geklappt. Bitte nochmals versuchen.</p>
        @else
            <p class="mt-2 text-sm text-zinc-600">Anmelden mit deinem novu-Konto.</p>
        @endif

        @if ($configured)
            <a href="{{ route('sso') }}"
               class="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700">
                Mit novu anmelden
            </a>
        @else
            <p class="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800">
                novu SSO ist noch nicht eingerichtet: <span class="font-mono">NOVU_AUTH_CLIENT_ID</span> und
                <span class="font-mono">NOVU_AUTH_CLIENT_SECRET</span> fehlen (OAuth Client auf auth.novu.ch).
            </p>
        @endif

        @if ($devLogin)
            <form method="POST" action="{{ route('auth.dev') }}" class="mt-3">
                @csrf
                <button class="w-full rounded-md border border-dashed border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50">Lokal ohne SSO anmelden (nur Entwicklung)</button>
            </form>
        @endif
    </div>
</x-app>
