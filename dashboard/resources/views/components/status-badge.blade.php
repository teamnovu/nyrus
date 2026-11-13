@props(['status'])
@php
    $styles = [
        'active' => 'bg-gold/20 text-gold',
        'pending' => 'bg-gold-light/15 text-gold-light',
        'busy' => 'bg-gold/20 text-gold',
        'awaitingInput' => 'bg-warning/20 text-warning',
        'complete' => 'bg-white/10 text-white/75',
        'idle' => 'bg-gold/20 text-gold',
        'error' => 'bg-danger/20 text-danger',
        'down' => 'bg-danger/20 text-danger',
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
<span {{ $attributes->class(['chip', $styles[$status] ?? 'bg-white/10 text-white/70']) }}>
    <span @class(['chip-dot', 'animate-pulse-soft' => $pulse])></span>{{ $labels[$status] ?? $status }}
</span>
