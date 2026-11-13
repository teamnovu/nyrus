@foreach ($entries as $entry)
<div class="log-line flex flex-wrap gap-x-3 px-4 py-1 hover:bg-white/[0.03] sm:flex-nowrap sm:px-5 sm:py-px" data-level="{{ $entry['level'] }}">
<span class="w-[4.75rem] shrink-0 text-white/30 tabular-nums" @if ($entry['stamp']) title="{{ $entry['stamp'] }}" @endif>{{ $entry['time'] }}</span>
<span @class([
    'w-11 shrink-0 font-medium',
    'text-danger' => $entry['level'] === 'ERROR',
    'text-warning' => $entry['level'] === 'WARN',
    'text-white/30' => $entry['level'] === 'DEBUG',
    'text-white/45' => ! in_array($entry['level'], ['ERROR', 'WARN', 'DEBUG'], true),
])>{{ $entry['level'] }}</span>
<span @class(['w-full min-w-0 break-words whitespace-pre-wrap sm:w-auto sm:flex-1', 'text-danger/90' => $entry['level'] === 'ERROR', 'text-white/80' => $entry['level'] !== 'ERROR'])>@if ($entry['source'])<span class="text-gold/70">{{ $entry['source'] }}</span> @endif{{ $entry['message'] }}</span>
</div>
@endforeach
