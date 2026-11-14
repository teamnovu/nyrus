@foreach ($entries as $entry)
<div class="log-line log-row" data-level="{{ $entry['level'] }}">
<span class="text-white/35 tabular-nums" @if ($entry['stamp']) title="{{ $entry['stamp'] }}" @endif>{{ $entry['time'] }}</span>
<span @class([
    'text-[11px] font-semibold tracking-wide leading-6',
    'text-danger' => $entry['level'] === 'ERROR',
    'text-warning' => $entry['level'] === 'WARN',
    'text-white/30' => $entry['level'] === 'DEBUG',
    'text-info/80' => ! in_array($entry['level'], ['ERROR', 'WARN', 'DEBUG'], true),
])>{{ $entry['level'] }}</span>
<span class="hidden truncate text-gold/75 sm:block" @if ($entry['source']) title="{{ $entry['source'] }}" @endif>{{ $entry['source'] }}</span>
<span @class(['log-message min-w-0 break-words whitespace-pre-wrap', 'text-danger/90' => $entry['level'] === 'ERROR', 'text-white/85' => $entry['level'] !== 'ERROR'])>@if ($entry['source'])<span class="text-gold/75 sm:hidden">{{ $entry['source'] }} </span>@endif{{ $entry['message'] }}</span>
</div>
@endforeach
