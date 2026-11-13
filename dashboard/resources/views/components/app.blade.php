@props(['title' => null, 'bare' => false])
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>{{ $title ?? 'nyrus' }} · nyrus</title>
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" href="/brand/favicon-32x32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
    {{-- novu brand font (neuzeit-grotesk, same Adobe Fonts kit as novu.ch) --}}
    <link rel="preconnect" href="https://use.typekit.net" crossorigin>
    <link rel="stylesheet" href="https://use.typekit.net/kjp6bci.css">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen antialiased">
    @auth
        <header class="bg-black text-white">
            <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4">
                <a href="{{ route('dashboard') }}" class="flex items-center gap-3" aria-label="nyrus Übersicht">
                    <img src="/brand/novu-white.svg" alt="novu" class="h-4 w-auto">
                    <span class="border-l border-white/20 pl-3 text-sm font-medium tracking-[0.25em] text-gold-700 uppercase">nyrus</span>
                </a>
                <nav class="flex flex-wrap gap-x-6 gap-y-2 text-sm tracking-wide uppercase">
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
                               'border-b-2 pb-1 transition-colors',
                               'border-gold-700 text-gold-700' => $active,
                               'border-transparent text-white/70 hover:text-white' => ! $active,
                           ])>{{ $label }}</a>
                    @endforeach
                </nav>
                <div class="ml-auto flex items-center gap-3 text-sm">
                    <span class="hidden text-white/60 sm:inline">{{ auth()->user()->name }}</span>
                    <form method="POST" action="{{ route('logout') }}">
                        @csrf
                        <button class="tracking-wide text-white/60 uppercase transition-colors hover:text-gold-700">Abmelden</button>
                    </form>
                </div>
            </div>
        </header>
    @endauth

    <main @class(['mx-auto max-w-6xl px-4', 'py-10' => ! $bare])>
        @if (session('status'))
            <div class="mb-6 border-l-4 border-gold-700 bg-white px-4 py-3 text-sm">{{ session('status') }}</div>
        @endif
        @if (session('error'))
            <div class="mb-6 border-l-4 border-red-700 bg-white px-4 py-3 text-sm text-red-800">{{ session('error') }}</div>
        @endif
        @if ($errors->any())
            <div class="mb-6 border-l-4 border-red-700 bg-white px-4 py-3 text-sm text-red-800">
                <ul class="list-disc pl-5">
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
