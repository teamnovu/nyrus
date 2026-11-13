<x-app title="Anmelden" :bare="true">
    <div class="fixed inset-0 flex flex-col bg-ink px-6 py-6 text-white">
        <img src="/brand/union-white.svg" alt="Union" class="h-7 w-auto self-start">

        <div class="flex flex-1 flex-col justify-center">
            <h1 class="text-6xl font-extrabold tracking-tight sm:text-8xl">nyrus</h1>
            <p class="mt-4 max-w-md text-lg font-bold text-white/70">Das Dashboard für unseren Coding-Agent.</p>

            <div class="mt-10 max-w-md">
                @if (request()->has('logout'))
                    <p class="text-sm font-bold text-white/70">Du bist abgemeldet.</p>
                @elseif ($failed && ! session('error'))
                    <p class="text-sm font-bold text-coral">Die Anmeldung über novu SSO hat nicht geklappt. Bitte nochmals versuchen.</p>
                @elseif (session('error'))
                    <p class="text-sm font-bold text-coral">{{ session('error') }}</p>
                @endif

                @if ($configured)
                    <a href="{{ route('sso') }}"
                       class="mt-6 inline-flex items-center justify-center rounded-full bg-brand px-8 py-3 text-base font-extrabold text-ink transition-colors hover:bg-white">
                        Mit novu anmelden
                    </a>
                @else
                    <p class="mt-6 rounded-2xl border border-peach px-4 py-3 text-sm text-peach">
                        novu SSO ist noch nicht eingerichtet: <span class="font-mono">NOVU_AUTH_CLIENT_ID</span> und
                        <span class="font-mono">NOVU_AUTH_CLIENT_SECRET</span> fehlen (OAuth Client auf auth.novu.ch).
                    </p>
                @endif

                @if ($devLogin)
                    <form method="POST" action="{{ route('auth.dev') }}" class="mt-4">
                        @csrf
                        <button class="rounded-full border border-dashed border-white/40 px-5 py-2 text-sm font-bold text-white/70 hover:text-white">Lokal ohne SSO anmelden (nur Entwicklung)</button>
                    </form>
                @endif
            </div>
        </div>
    </div>
</x-app>
