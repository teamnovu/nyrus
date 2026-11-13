@props(['status'])
@php
    $styles = [
        'active' => 'bg-gold text-ink',
        'pending' => 'bg-gold-light text-ink',
        'busy' => 'bg-gold text-ink',
        'awaitingInput' => 'bg-warning text-ink',
        'complete' => 'bg-ink text-white',
        'idle' => 'bg-gold text-ink',
        'error' => 'bg-danger text-white',
        'down' => 'bg-danger text-white',
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
<span {{ $attributes->class(['inline-flex items-center rounded-full px-3 py-0.5 text-xs font-bold', $styles[$status] ?? 'bg-paper text-graphite']) }}>{{ $labels[$status] ?? $status }}</span>
