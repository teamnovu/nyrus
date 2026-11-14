<x-app title="Anmelden" :bare="true">
    <div class="flex min-h-screen items-center justify-center py-10">
        <div class="w-full max-w-sm">
            <div class="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-white">
                <span class="relative flex size-3" aria-hidden="true">
                    <span class="absolute inset-0 rounded-full bg-gold opacity-70 blur-[6px]"></span>
                    <span class="relative size-3 rounded-full bg-gold"></span>
                </span>
                nyrus
            </div>
            <p class="muted mt-2 text-sm">Dashboard für den Coding-Agent.</p>

            <div class="card mt-8 p-6">
                @if (request()->has('logout'))
                    <p class="mb-4 text-sm text-white/70">Du bist abgemeldet.</p>
                @elseif ($failed && ! session('error'))
                    <p class="mb-4 text-sm text-danger">Die Anmeldung über novu SSO hat nicht geklappt. Bitte nochmals versuchen.</p>
                @elseif (session('error'))
                    <p class="mb-4 text-sm text-danger">{{ session('error') }}</p>
                @endif

                @if ($configured)
                    <a href="{{ route('sso') }}" class="btn w-full !h-10">Mit novu anmelden</a>
                @else
                    <p class="text-sm text-warning">
                        SSO ist noch nicht eingerichtet: <span class="font-mono">NOVU_AUTH_CLIENT_ID</span> und
                        <span class="font-mono">NOVU_AUTH_CLIENT_SECRET</span> fehlen (OAuth Client auf auth.novu.ch).
                    </p>
                @endif

                @if ($devLogin)
                    <form method="POST" action="{{ route('auth.dev') }}" class="mt-3">
                        @csrf
                        <button class="btn-ghost w-full !h-10">Lokal ohne SSO anmelden</button>
                    </form>
                @endif
            </div>
        </div>
    </div>
</x-app>
