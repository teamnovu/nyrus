@props(['status'])
@php
    $styles = [
        'active' => 'text-gold',
        'pending' => 'text-gold-light',
        'busy' => 'text-gold',
        'awaitingInput' => 'text-warning',
        'complete' => 'text-white/55',
        'idle' => 'text-white/80',
        'error' => 'text-danger',
        'down' => 'text-danger',
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
    $pulse = in_array($status, ['active', 'busy', 'pending'], true);
@endphp
<span {{ $attributes->class(['chip', $styles[$status] ?? 'text-white/60']) }}>
    <span @class(['chip-dot', 'animate-pulse' => $pulse])></span>{{ $labels[$status] ?? $status }}
</span>
