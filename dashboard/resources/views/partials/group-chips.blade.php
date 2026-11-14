{{-- Source chip of a repository group (see App\Services\ProjectOverview::groups()). --}}
@if (str_starts_with($group['key'], 'repo:'))
    <span class="chip chip-meta text-white/50" data-group-source="alone" title="Keine anderen Repos in dieser Gruppe">eigene Gruppe</span>
@elseif ($group['source'] === 'inbudget')
    <span class="chip chip-meta text-gold-light" data-group-source="inbudget" title="Gruppe aus dem inBudget-Kunden">Kunde</span>
@else
    <span class="chip chip-meta text-white/65" data-group-source="manual" title="Gruppe im Dashboard festgelegt">manuell</span>
@endif
