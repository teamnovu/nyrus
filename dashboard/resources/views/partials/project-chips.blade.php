{{--
    Chips of one repository row (see App\Services\ProjectOverview), in three shapes:
    trackers as tags with a brand mark, the source as a dashed outline, the state as a pill.
--}}
@php($githubCovered = $row['trackers']['github']['covered'] ?? false)
<div class="flex flex-wrap items-center gap-1.5" data-chips>
    @foreach ($row['trackers'] as $tracker)
        @if ($tracker['inheritedOnly'] ?? false)
            <span class="chip chip-tag" data-tracker-chip="{{ $tracker['platform'] }}" data-inherited title="Von der Gruppe geerbt"><span class="mark mark-{{ $tracker['platform'] }} opacity-60"></span>{{ $tracker['label'] }}</span>
        @elseif ($tracker['covered'])
            @php($summary = $tracker['summary'])
            <span class="chip chip-tag" data-tracker-chip="{{ $tracker['platform'] }}"><span class="mark mark-{{ $tracker['platform'] }}"></span>{{ $tracker['label'] }}@if ($summary) <span class="tag-key">{{ implode(', ', array_slice($summary, 0, 2)) }}{{ count($summary) > 2 ? ' +'.(count($summary) - 2) : '' }}</span>@endif</span>
        @endif
    @endforeach
    @foreach ($row['others'] as $other)
        <span class="chip chip-tag"><span class="mark mark-other"></span>{{ $other['linearWorkspaceId'] ?? 'Anderer Tracker' }}</span>
    @endforeach
    @if ($row['missing'])
        <span class="chip {{ $githubCovered ? 'chip-meta text-white/50' : 'text-warning' }}" data-tracker-missing
              title="{{ $githubCovered ? 'Funktioniert über GitHub Issues. Ergänze das Projekt, damit auch Tickets ankommen.' : 'Ohne Tracker bekommt nyrus keine Tickets für dieses Repository.' }}">@unless ($githubCovered)<x-icon name="warning" class="size-3.5" />@endunless{{ implode('/', $row['missing']) }} fehlt</span>
    @elseif (! $row['hasTicketTracker'] && ! $githubCovered && ! $row['others'])
        <span class="chip text-warning" data-tracker-missing><x-icon name="warning" class="size-3.5" />kein Tracker</span>
    @endif

    @if ($row['inbudget'])
        <span class="chip chip-meta text-gold-light" title="Kommt aus inBudget">inBudget</span>
    @endif
    @if ($row['manual'])
        <span class="chip chip-meta text-white/60" title="Im Dashboard angelegt">manuell</span>
    @endif

    @if (! $row['hasEntries'])
        <span class="chip chip-status text-white/45" data-state="unconfigured"><span class="chip-dot opacity-60"></span>nicht eingerichtet</span>
    @elseif ($row['active'])
        <span class="chip chip-status text-success" data-state="active"><span class="chip-dot"></span>aktiv</span>
    @else
        <span class="chip chip-status text-white/55" data-state="inactive"><span class="chip-dot"></span>inaktiv</span>
    @endif
</div>
