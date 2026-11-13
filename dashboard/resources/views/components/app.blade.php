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
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen antialiased">
    @auth
        <header class="bg-ink text-white">
            <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-5">
                <a href="{{ route('dashboard') }}" class="flex items-center gap-3" aria-label="nyrus Übersicht">
                    <img src="/brand/novu-white.svg" alt="novu" class="h-5 w-auto">
                    <span class="rounded-full bg-gold px-3 py-0.5 text-sm font-extrabold text-ink">nyrus</span>
                </a>
                <nav class="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold">
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
                               'transition-colors',
                               'text-gold' => $active,
                               'text-white hover:text-gold' => ! $active,
                           ])>{{ $label }}</a>
                    @endforeach
                </nav>
                <div class="ml-auto flex items-center gap-4 text-sm font-bold">
                    <span class="hidden text-white/60 sm:inline">{{ auth()->user()->name }}</span>
                    <form method="POST" action="{{ route('logout') }}">
                        @csrf
                        <button class="rounded-full border border-white/40 px-4 py-1 transition-colors hover:border-gold hover:text-gold">Abmelden</button>
                    </form>
                </div>
            </div>
        </header>
    @endauth

    <main @class(['mx-auto max-w-6xl px-4', 'py-10' => ! $bare])>
        @if (session('status'))
            <div class="mb-6 rounded-2xl bg-gold-light px-4 py-3 text-sm font-bold">{{ session('status') }}</div>
        @endif
        @if (session('error'))
            <div class="mb-6 rounded-2xl bg-danger px-4 py-3 text-sm font-bold text-white">{{ session('error') }}</div>
        @endif
        @if ($errors->any())
            <div class="mb-6 rounded-2xl bg-danger px-4 py-3 text-sm font-bold text-white">
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
