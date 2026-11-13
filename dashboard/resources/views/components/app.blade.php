@props(['title' => null])
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>{{ $title ?? 'nyrus' }} · nyrus Dashboard</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
    @auth
        <header class="border-b border-zinc-200 bg-white">
            <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                <a href="{{ route('dashboard') }}" class="font-semibold tracking-tight">nyrus</a>
                <nav class="flex flex-wrap gap-1 text-sm">
                    @foreach ([
                        'dashboard' => 'Übersicht',
                        'repositories.index' => 'Repositories',
                        'settings.index' => 'Einstellungen',
                        'logs.index' => 'Logs',
                        'audit.index' => 'Audit-Log',
                    ] as $route => $label)
                        <a href="{{ route($route) }}"
                           @class([
                               'rounded-md px-3 py-1.5',
                               'bg-zinc-900 text-white' => request()->routeIs($route) || ($route === 'dashboard' && request()->routeIs('sessions.*')),
                               'text-zinc-600 hover:bg-zinc-100' => ! (request()->routeIs($route) || ($route === 'dashboard' && request()->routeIs('sessions.*'))),
                           ])>{{ $label }}</a>
                    @endforeach
                </nav>
                <div class="ml-auto flex items-center gap-3 text-sm">
                    @if (auth()->user()->avatar)
                        <img src="{{ auth()->user()->avatar }}" alt="" class="size-7 rounded-full" referrerpolicy="no-referrer">
                    @endif
                    <span class="hidden text-zinc-600 sm:inline">{{ auth()->user()->name }}</span>
                    <form method="POST" action="{{ route('logout') }}">
                        @csrf
                        <button class="text-zinc-500 hover:text-zinc-900">Abmelden</button>
                    </form>
                </div>
            </div>
        </header>
    @endauth

    <main class="mx-auto max-w-6xl px-4 py-8">
        @if (session('status'))
            <div class="mb-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{{ session('status') }}</div>
        @endif
        @if (session('error'))
            <div class="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{{ session('error') }}</div>
        @endif
        @if ($errors->any())
            <div class="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
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
