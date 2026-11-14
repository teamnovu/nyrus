{{-- Effective Jira/ClickUp chips of a repository group (own ∪ members' keys; only with group-level trackers). --}}
@foreach (\App\Services\ProjectOverview::TICKET_TRACKERS as $platform)
    @php($keys = $group['platforms'][$platform]['effective'] ?? null)
    @if ($keys && ($keys['teamKeys'] || $keys['projectKeys']))
        @php($summary = \App\Services\ProjectOverview::summary($platform, $keys))
        <span class="chip text-white/75" data-group-tracker-chip="{{ $platform }}" title="Gilt für alle Repos der Gruppe">{{ \App\Services\ProjectOverview::LABELS[$platform] }}@if ($summary) <span class="text-white/50">{{ implode(', ', array_slice($summary, 0, 2)) }}{{ count($summary) > 2 ? ' +'.(count($summary) - 2) : '' }}</span>@endif</span>
    @endif
@endforeach
