<x-app title="Audit-Log">
    <p class="eyebrow">Betrieb</p>
    <h1 class="mt-3 text-5xl sm:text-6xl">Audit-Log</h1>
    <p class="muted mt-2 text-sm">Wer hat wann was über das Dashboard geändert. Werte von Secrets werden nie gespeichert.</p>

    <div class="mt-8 space-y-2">
        @forelse ($logs as $log)
            <div class="glass flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-sm">
                <span class="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold/40 to-gold-dark/40 text-xs font-extrabold text-white">{{ $log->user ? \Illuminate\Support\Str::of($log->user->name)->explode(' ')->map(fn ($p) => mb_substr($p, 0, 1))->take(2)->join('') : '–' }}</span>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="font-bold text-white">{{ $log->user?->name ?? '–' }}</span>
                        <span class="chip bg-white/[0.07] font-mono text-white/70">{{ $log->action }}</span>
                        <span class="text-white/80">{{ $log->subject }}</span>
                    </div>
                    <div class="muted mt-0.5 text-xs">{{ $log->created_at->timezone('Europe/Zurich')->format('d.m.Y H:i') }} · {{ $log->created_at->diffForHumans() }}</div>
                </div>
                @if ($log->success)
                    <span class="chip bg-gold/15 text-gold"><span class="chip-dot"></span>ok</span>
                @else
                    <span class="chip bg-danger/20 text-danger" title="{{ $log->details['error'] ?? '' }}"><span class="chip-dot"></span>fehlgeschlagen</span>
                @endif
            </div>
        @empty
            <div class="glass px-6 py-12 text-center">
                <p class="font-bold text-white">Noch keine Einträge.</p>
            </div>
        @endforelse
    </div>
    <div class="mt-6">{{ $logs->links() }}</div>
</x-app>
