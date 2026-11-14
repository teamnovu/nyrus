{{-- Tracker, source and status chips of one repository row (see App\Services\ProjectOverview). --}}
@php($githubCovered = $row['trackers']['github']['covered'] ?? false)
<div class="flex flex-wrap items-center gap-1.5" data-chips>
    @foreach ($row['trackers'] as $tracker)
        @if ($tracker['inheritedOnly'] ?? false)
            <span class="chip text-white/40" data-tracker-chip="{{ $tracker['platform'] }}" data-inherited title="Von der Gruppe geerbt">{{ $tracker['label'] }}</span>
        @elseif ($tracker['covered'])
            @php($summary = $tracker['summary'])
            <span class="chip text-white/75" data-tracker-chip="{{ $tracker['platform'] }}">{{ $tracker['label'] }}@if ($summary) <span class="text-white/50">{{ implode(', ', array_slice($summary, 0, 2)) }}{{ count($summary) > 2 ? ' +'.(count($summary) - 2) : '' }}</span>@endif</span>
        @endif
    @endforeach
    @foreach ($row['others'] as $other)
        <span class="chip text-white/60">{{ $other['linearWorkspaceId'] ?? 'Anderer Tracker' }}</span>
    @endforeach
    @if ($row['missing'])
        <span @class(['chip', 'text-warning' => ! $githubCovered, 'text-white/45' => $githubCovered]) data-tracker-missing
              title="{{ $githubCovered ? 'Funktioniert über GitHub Issues. Ergänze das Projekt, damit auch Tickets ankommen.' : 'Ohne Tracker bekommt nyrus keine Tickets für dieses Repository.' }}">{{ implode('/', $row['missing']) }} fehlt</span>
    @elseif (! $row['hasTicketTracker'] && ! $githubCovered && ! $row['others'])
        <span class="chip text-warning" data-tracker-missing>kein Tracker</span>
    @endif

    @if ($row['inbudget'])
        <span class="chip text-gold-light/80">inBudget</span>
    @endif
    @if ($row['manual'])
        <span class="chip text-white/60">manuell</span>
    @endif

    @if (! $row['hasEntries'])
        <span class="chip text-white/40">nicht eingerichtet</span>
    @elseif ($row['active'])
        <span class="chip text-gold"><span class="chip-dot"></span>aktiv</span>
    @else
        <span class="chip text-white/50">inaktiv</span>
    @endif
</div>
