@props(['title' => null, 'bare' => false])
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#09090b">
    <title>{{ $title ?? 'nyrus' }} · nyrus</title>
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" href="/brand/favicon-32x32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen">
    @auth
        <header class="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl" data-site-header>
            {{-- a thin gold line that fades out to the sides --}}
            <div class="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-linear-to-r from-transparent via-gold/40 to-transparent" aria-hidden="true"></div>
            <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 px-4 sm:flex-nowrap sm:px-6">
                <a href="{{ route('dashboard') }}" class="group flex h-14 shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight text-white">
                    <span class="relative flex size-2.5" aria-hidden="true">
                        <span class="absolute inset-0 rounded-full bg-gold opacity-60 blur-[5px] transition-opacity group-hover:opacity-100"></span>
                        <span class="relative size-2.5 rounded-full bg-gold"></span>
                    </span>
                    nyrus
                </a>

                <nav class="order-last -mx-4 flex w-[calc(100%+2rem)] min-w-0 gap-1 overflow-x-auto px-3 text-sm [scrollbar-width:none] sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:px-0">
                    @foreach ([
                        'dashboard' => ['Übersicht', 'home'],
                        'repositories.index' => ['Projekte', 'folder'],
                        'settings.index' => ['Einstellungen', 'cog'],
                        'logs.index' => ['Logs', 'terminal'],
                        'audit.index' => ['Audit-Log', 'shield'],
                    ] as $route => [$label, $icon])
                        @php($active = request()->routeIs($route) || ($route === 'dashboard' && request()->routeIs('sessions.*')) || ($route === 'repositories.index' && request()->routeIs('projects.index', 'repositories.show', 'repositories.inbudget', 'repositories.group')))
                        <a href="{{ route($route) }}"
                           @if ($active) aria-current="page" @endif
                           @class([
                               'relative flex h-11 shrink-0 items-center gap-2 rounded-md px-3 transition-colors duration-150 sm:h-14',
                               'text-white' => $active,
                               'text-white/55 hover:text-white' => ! $active,
                           ])>
                            <x-icon :name="$icon" @class(['size-4', 'text-gold' => $active, 'text-white/40' => ! $active]) />
                            {{ $label }}
                            @if ($active)
                                <span class="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold" aria-hidden="true"></span>
                            @endif
                        </a>
                    @endforeach
                </nav>

                <div class="ml-auto flex h-14 shrink-0 items-center gap-3">
                    <span class="hidden items-center gap-2 text-sm text-white/55 md:flex">
                        <span class="flex size-6 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-semibold text-white/80" aria-hidden="true">{{ mb_strtoupper(mb_substr(auth()->user()->name, 0, 1)) }}</span>
                        {{ auth()->user()->name }}
                    </span>
                    <form method="POST" action="{{ route('logout') }}">
                        @csrf
                        <button class="btn-ghost !h-8 !px-2.5" title="Abmelden">
                            <x-icon name="logout" class="size-4 text-white/60" />
                            <span class="hidden sm:inline">Abmelden</span>
                        </button>
                    </form>
                </div>
            </div>
        </header>
    @endauth

    <main @class(['mx-auto px-4 sm:px-6', 'max-w-7xl', 'pt-8 pb-24 sm:pt-10' => ! $bare])>
        @if (session('status'))
            <div class="notice mb-6 border-success/30" data-flash>
                <span class="notice-dot text-success" aria-hidden="true"></span>
                <span>{{ session('status') }}</span>
            </div>
        @endif
        @if (session('error') && ! $bare)
            <div class="notice mb-6 border-danger/30">
                <span class="notice-dot text-danger" aria-hidden="true"></span>
                <span>{{ session('error') }}</span>
            </div>
        @endif
        @if ($errors->any())
            <div class="notice mb-6 border-danger/30">
                <span class="notice-dot text-danger" aria-hidden="true"></span>
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
