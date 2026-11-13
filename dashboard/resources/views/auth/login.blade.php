<x-app title="Anmelden" :bare="true">
    <div class="fixed inset-0 flex items-center justify-center bg-black px-4">
        <div class="w-full max-w-sm text-center text-white">
            <img src="/brand/novu-gold.svg" alt="novu" class="mx-auto h-6 w-auto">
            <p class="mt-4 text-sm font-medium tracking-[0.3em] text-white/60 uppercase">nyrus Dashboard</p>

            <div class="mt-10">
                @if (request()->has('logout'))
                    <p class="text-sm text-white/70">Du bist abgemeldet.</p>
                @elseif ($failed && ! session('error'))
                    <p class="text-sm text-red-300">Die Anmeldung über novu SSO hat nicht geklappt. Bitte nochmals versuchen.</p>
                @elseif (session('error'))
                    <p class="text-sm text-red-300">{{ session('error') }}</p>
                @else
                    <p class="text-sm text-white/70">Anmelden mit deinem novu-Konto.</p>
                @endif

                @if ($configured)
                    <a href="{{ route('sso') }}"
                       class="mt-6 inline-flex w-full items-center justify-center bg-gold-700 px-4 py-3 text-sm font-bold tracking-widest text-black uppercase transition-colors hover:bg-gold-600">
                        Mit novu anmelden
                    </a>
                @else
                    <p class="mt-6 border border-gold-700/40 px-3 py-2 text-left text-sm text-gold-600">
                        novu SSO ist noch nicht eingerichtet: <span class="font-mono">NOVU_AUTH_CLIENT_ID</span> und
                        <span class="font-mono">NOVU_AUTH_CLIENT_SECRET</span> fehlen (OAuth Client auf auth.novu.ch).
                    </p>
                @endif

                @if ($devLogin)
                    <form method="POST" action="{{ route('auth.dev') }}" class="mt-3">
                        @csrf
                        <button class="w-full border border-dashed border-white/30 px-4 py-2 text-sm text-white/60 hover:text-white">Lokal ohne SSO anmelden (nur Entwicklung)</button>
                    </form>
                @endif
            </div>
        </div>
    </div>
</x-app>
