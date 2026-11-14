@props(['status'])
@php
    // running: blue (pulsing) · waiting: amber · done/free: green · failed: red · gone: grey
    $styles = [
        'active' => 'text-info',
        'pending' => 'text-info',
        'busy' => 'text-info',
        'awaitingInput' => 'text-warning',
        'complete' => 'text-success',
        'idle' => 'text-success',
        'error' => 'text-danger',
        'stale' => 'text-white/50',
        'down' => 'text-danger',
    ];
    $labels = [
        'active' => 'läuft',
        'pending' => 'startet',
        'awaitingInput' => 'wartet auf Antwort',
        'complete' => 'fertig',
        'error' => 'Fehler',
        'stale' => 'unterbrochen',
        'idle' => 'frei',
        'busy' => 'beschäftigt',
        'down' => 'nicht erreichbar',
    ];
    $ping = in_array($status, ['active', 'busy', 'pending'], true);
@endphp
<span {{ $attributes->class(['chip chip-status', $styles[$status] ?? 'text-white/60']) }}>
    <span class="chip-dot" @if ($ping) data-ping @endif></span>{{ $labels[$status] ?? $status }}
</span>
