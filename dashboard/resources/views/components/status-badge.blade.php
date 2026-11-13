@props(['status'])
@php
    $styles = [
        'active' => 'bg-brand text-ink',
        'pending' => 'bg-brand-muted text-ink',
        'busy' => 'bg-brand text-ink',
        'awaitingInput' => 'bg-peach text-ink',
        'complete' => 'bg-ink text-white',
        'idle' => 'bg-brand text-ink',
        'error' => 'bg-coral text-white',
        'down' => 'bg-coral text-white',
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
<span {{ $attributes->class(['inline-flex items-center rounded-full px-3 py-0.5 text-xs font-bold', $styles[$status] ?? 'bg-paper text-brown']) }}>{{ $labels[$status] ?? $status }}</span>
