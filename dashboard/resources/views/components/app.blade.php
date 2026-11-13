@props(['title' => null, 'bare' => false])
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#0a0a0a">
    <title>{{ $title ?? 'nyrus' }} · nyrus</title>
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" href="/brand/favicon-32x32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen">
    @auth
        <header class="sticky top-0 z-30 border-b border-white/[0.06] bg-canvas/85 backdrop-blur-md">
            <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 px-4 sm:flex-nowrap sm:px-6">
                <a href="{{ route('dashboard') }}" class="flex h-14 shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight text-white">
                    <span class="size-2 rounded-full bg-gold" aria-hidden="true"></span>nyrus
                </a>

                <nav class="order-last -mx-4 flex w-[calc(100%+2rem)] min-w-0 gap-1 overflow-x-auto px-3 pb-2 text-sm [scrollbar-width:none] sm:order-none sm:mx-0 sm:w-auto sm:flex-1 sm:px-0 sm:pb-0">
                    @foreach ([
                        'dashboard' => 'Übersicht',
                        'repositories.index' => 'Repositories',
                        'settings.index' => 'Einstellungen',
                        'logs.index' => 'Logs',
                        'audit.index' => 'Audit-Log',
                    ] as $route => $label)
                        @php($active = request()->routeIs($route) || ($route === 'dashboard' && request()->routeIs('sessions.*')))
                        <a href="{{ route($route) }}"
                           @if ($active) aria-current="page" @endif
                           @class([
                               'shrink-0 rounded-md px-3 py-1.5 transition-colors duration-150',
                               'bg-white/[0.07] text-white' => $active,
                               'text-white/50 hover:text-white' => ! $active,
                           ])>{{ $label }}</a>
                    @endforeach
                </nav>

                <div class="ml-auto flex h-14 shrink-0 items-center gap-4">
                    <span class="hidden text-sm text-white/45 md:inline">{{ auth()->user()->name }}</span>
                    <form method="POST" action="{{ route('logout') }}">
                        @csrf
                        <button class="btn-ghost !h-8 !px-3">Abmelden</button>
                    </form>
                </div>
            </div>
        </header>
    @endauth

    <main @class(['mx-auto max-w-6xl px-4 sm:px-6', 'pt-10 pb-20' => ! $bare])>
        @if (session('status'))
            <div class="notice mb-6">
                <span class="notice-dot text-gold" aria-hidden="true"></span>
                <span>{{ session('status') }}</span>
            </div>
        @endif
        @if (session('error') && ! $bare)
            <div class="notice mb-6">
                <span class="notice-dot text-danger" aria-hidden="true"></span>
                <span>{{ session('error') }}</span>
            </div>
        @endif
        @if ($errors->any())
            <div class="notice mb-6">
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
