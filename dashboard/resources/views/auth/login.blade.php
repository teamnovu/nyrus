<x-app title="Anmelden" :bare="true">
    <div class="flex min-h-screen items-center justify-center py-10">
        <div class="glass-strong w-full max-w-md animate-rise p-8 sm:p-10">
            <img src="/brand/union-white.svg" alt="Union" class="h-5 w-auto">

            <h1 class="mt-12 text-6xl leading-none sm:text-7xl">nyrus</h1>
            <p class="muted mt-3 text-base font-bold">Das Dashboard für unseren Coding-Agent.</p>

            <div class="mt-10">
                @if (request()->has('logout'))
                    <p class="text-sm font-bold text-white/70">Du bist abgemeldet.</p>
                @elseif ($failed && ! session('error'))
                    <p class="text-sm font-bold text-coral">Die Anmeldung über novu SSO hat nicht geklappt. Bitte nochmals versuchen.</p>
                @elseif (session('error'))
                    <p class="text-sm font-bold text-coral">{{ session('error') }}</p>
                @endif

                @if ($configured)
                    <a href="{{ route('sso') }}" class="btn mt-5 w-full !py-3.5 !text-base">
                        Mit novu anmelden
                        <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.64l-3.97-3.97a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06l3.97-3.97H3.75A.75.75 0 0 1 3 10Z" clip-rule="evenodd"/></svg>
                    </a>
                @else
                    <div class="mt-5 rounded-2xl bg-peach/10 px-4 py-3 text-sm text-peach">
                        novu SSO ist noch nicht eingerichtet: <span class="font-mono">NOVU_AUTH_CLIENT_ID</span> und
                        <span class="font-mono">NOVU_AUTH_CLIENT_SECRET</span> fehlen (OAuth Client auf auth.novu.ch).
                    </div>
                @endif

                @if ($devLogin)
                    <form method="POST" action="{{ route('auth.dev') }}" class="mt-3">
                        @csrf
                        <button class="btn-ghost w-full">Lokal ohne SSO anmelden (nur Entwicklung)</button>
                    </form>
                @endif
            </div>
        </div>
    </div>
</x-app>
