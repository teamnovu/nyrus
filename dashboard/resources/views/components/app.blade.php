@props(['title' => null, 'bare' => false])
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#070707">
    <title>{{ $title ?? 'nyrus' }} · nyrus</title>
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" href="/brand/favicon-96x96.png" sizes="96x96">
    <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen">
    {{-- drifting color light in Union colors --}}
    <div class="aurora" aria-hidden="true">
        <div class="aurora-blob -left-[10vw] -top-[15vh] size-[55vw] animate-drift-a bg-brand/50"></div>
        <div class="aurora-blob -right-[15vw] top-[10vh] size-[45vw] animate-drift-b bg-[#2bb5a8]/40"></div>
        <div class="aurora-blob bottom-[-20vh] left-[20vw] size-[50vw] animate-drift-c bg-peach/30"></div>
        <div class="aurora-blob bottom-[5vh] right-[-5vw] size-[30vw] animate-drift-a bg-coral/25 [animation-delay:-12s]"></div>
    </div>

    @auth
        <header class="sticky top-0 z-30 px-3 pt-3 sm:px-4 sm:pt-4">
            <div class="glass-strong mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 rounded-[1.75rem] py-2 pr-2 pl-5 sm:flex-nowrap sm:rounded-full">
                <a href="{{ route('dashboard') }}" class="flex shrink-0 items-center gap-2.5" aria-label="nyrus Übersicht">
                    <img src="/brand/union-white.svg" alt="Union" class="h-[18px] w-auto">
                    <span class="hidden rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-extrabold text-brand sm:inline">nyrus</span>
                </a>

                <nav class="order-last -ml-3 flex w-full min-w-0 gap-1 sm:order-none sm:ml-2 sm:w-auto sm:flex-1 overflow-x-auto text-sm font-bold [scrollbar-width:none]">
                    @foreach ([
                        'dashboard' => 'Übersicht',
                        'repositories.index' => 'Repositories',
                        'settings.index' => 'Einstellungen',
                        'logs.index' => 'Logs',
                        'audit.index' => 'Audit-Log',
                    ] as $route => $label)
                        @php($active = request()->routeIs($route) || ($route === 'dashboard' && request()->routeIs('sessions.*')))
                        <a href="{{ route($route) }}"
                           @class([
                               'shrink-0 rounded-full px-3.5 py-2 transition duration-300',
                               'bg-white/15 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]' => $active,
                               'text-white/60 hover:bg-white/[0.07] hover:text-white' => ! $active,
                           ])>{{ $label }}</a>
                    @endforeach
                </nav>

                <div class="ml-auto flex shrink-0 items-center gap-2">
                    <span class="hidden items-center gap-2 rounded-full bg-white/[0.06] py-1 pr-3 pl-1 text-xs font-bold text-white/70 md:flex">
                        <span class="grid size-7 place-items-center rounded-full bg-gradient-to-br from-brand to-[#2bb5a8] text-[11px] font-extrabold text-ink">{{ \Illuminate\Support\Str::of(auth()->user()->name)->explode(' ')->map(fn ($p) => mb_substr($p, 0, 1))->take(2)->join('') }}</span>
                        {{ auth()->user()->name }}
                    </span>
                    <form method="POST" action="{{ route('logout') }}">
                        @csrf
                        <button class="btn-ghost !px-4 !py-2" title="Abmelden">Abmelden</button>
                    </form>
                </div>
            </div>
        </header>
    @endauth

    <main @class(['relative mx-auto max-w-6xl px-4', 'pt-10 pb-16 animate-rise' => ! $bare])>
        @if (session('status'))
            <div class="notice mb-6 animate-rise">
                <span class="chip bg-brand/20 text-brand"><span class="chip-dot"></span></span>
                <span>{{ session('status') }}</span>
            </div>
        @endif
        @if (session('error') && ! $bare)
            <div class="notice mb-6 animate-rise">
                <span class="chip bg-coral/20 text-coral"><span class="chip-dot"></span></span>
                <span>{{ session('error') }}</span>
            </div>
        @endif
        @if ($errors->any())
            <div class="notice mb-6 animate-rise">
                <span class="chip bg-coral/20 text-coral"><span class="chip-dot"></span></span>
                <ul class="space-y-1">
                    @foreach ($errors->all() as $message)
                        <li>{{ $message }}</li>
                    @endforeach
                </ul>
            </div>
        @endif

        {{ $slot }}
    </main>
</body>
</html>
