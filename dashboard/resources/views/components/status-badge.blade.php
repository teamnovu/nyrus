@props(['status'])
@php
    $styles = [
        'active' => 'bg-blue-100 text-blue-800',
        'pending' => 'bg-blue-100 text-blue-800',
        'awaitingInput' => 'bg-amber-100 text-amber-800',
        'complete' => 'bg-emerald-100 text-emerald-800',
        'error' => 'bg-red-100 text-red-800',
        'idle' => 'bg-emerald-100 text-emerald-800',
        'busy' => 'bg-blue-100 text-blue-800',
        'down' => 'bg-red-100 text-red-800',
    ];
    $labels = [
        'active' => 'läuft',
        'pending' => 'startet',
        'awaitingInput' => 'wartet auf Antwort',
        'complete' => 'fertig',
        'error' => 'Fehler',
        'idle' => 'frei',
        'busy' => 'beschäftigt',
        'down' => 'nicht erreichbar',
    ];
@endphp
<span {{ $attributes->class(['inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', $styles[$status] ?? 'bg-zinc-100 text-zinc-700']) }}>{{ $labels[$status] ?? $status }}</span>
