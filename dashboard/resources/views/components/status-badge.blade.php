@props(['status'])
@php
    $styles = [
        'active' => 'bg-brand/20 text-brand',
        'pending' => 'bg-brand-muted/15 text-brand-muted',
        'busy' => 'bg-brand/20 text-brand',
        'awaitingInput' => 'bg-peach/20 text-peach',
        'complete' => 'bg-white/10 text-white/75',
        'idle' => 'bg-brand/20 text-brand',
        'error' => 'bg-coral/20 text-coral',
        'down' => 'bg-coral/20 text-coral',
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
