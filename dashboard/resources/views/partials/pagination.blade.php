{{-- Compact pager for a LengthAwarePaginator: Zurück · 1 … 4 5 6 … 33 · Weiter --}}
@if ($paginator->hasPages())
    @php($current = $paginator->currentPage())
    @php($last = $paginator->lastPage())
    @php($pages = collect([1, $current - 1, $current, $current + 1, $last])->filter(fn ($n) => $n >= 1 && $n <= $last)->unique()->sort()->values())
    <nav class="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Seiten">
        @if ($paginator->onFirstPage())
            <span class="btn-ghost pointer-events-none opacity-40" aria-disabled="true"><x-icon name="chevron-left" />Zurück</span>
        @else
            <a href="{{ $paginator->previousPageUrl() }}" rel="prev" class="btn-ghost"><x-icon name="chevron-left" />Zurück</a>
        @endif

        <div class="flex items-center gap-1 tabular-nums">
            @foreach ($pages as $i => $n)
                @if ($i > 0 && $n - $pages[$i - 1] > 1)
                    <span class="px-1 text-white/30" aria-hidden="true">…</span>
                @endif
                @if ($n === $current)
                    <span class="flex size-9 items-center justify-center rounded-lg border border-gold/40 bg-gold/10 text-gold-light" aria-current="page">{{ $n }}</span>
                @else
                    <a href="{{ $paginator->url($n) }}" class="flex size-9 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white" aria-label="Seite {{ $n }}">{{ $n }}</a>
                @endif
            @endforeach
        </div>

        @if ($paginator->hasMorePages())
            <a href="{{ $paginator->nextPageUrl() }}" rel="next" class="btn-ghost">Weiter<x-icon name="chevron-right" /></a>
        @else
            <span class="btn-ghost pointer-events-none opacity-40" aria-disabled="true">Weiter<x-icon name="chevron-right" /></span>
        @endif
    </nav>
@endif
