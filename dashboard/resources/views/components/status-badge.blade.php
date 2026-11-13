@props(['status'])
@php
    $styles = [
        'active' => 'bg-gold-700 text-ink',
        'pending' => 'bg-gold-600 text-ink',
        'busy' => 'bg-gold-700 text-ink',
        'awaitingInput' => 'border border-gold-800 text-gold-900',
        'complete' => 'bg-ink text-gold-600',
        'idle' => 'bg-ink text-gold-600',
        'error' => 'bg-red-700 text-white',
        'down' => 'bg-red-700 text-white',
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
<span {{ $attributes->class(['inline-flex items-center px-2 py-0.5 text-xs font-medium tracking-wider uppercase', $styles[$status] ?? 'bg-gold-200 text-brand-gray-dark']) }}>{{ $labels[$status] ?? $status }}</span>
