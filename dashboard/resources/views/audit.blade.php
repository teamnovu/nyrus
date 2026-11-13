<x-app title="Audit-Log">
    <p class="eyebrow">Betrieb</p>
    <h1 class="page-title">Audit-Log</h1>
    <p class="muted mt-2 text-sm">Wer hat wann was über das Dashboard geändert. Werte von Secrets werden nie gespeichert.</p>

    <div class="card mt-8 overflow-x-auto">
        <table class="w-full min-w-[640px] text-left text-sm">
            <thead class="text-xs text-white/40">
                <tr class="border-b border-white/[0.06]">
                    <th class="px-5 py-3 font-medium">Zeit</th>
                    <th class="px-5 py-3 font-medium">Person</th>
                    <th class="px-5 py-3 font-medium">Aktion</th>
                    <th class="px-5 py-3 font-medium">Betrifft</th>
                    <th class="px-5 py-3 text-right font-medium">Ergebnis</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.06]">
                @forelse ($logs as $log)
                    <tr class="card-row">
                        <td class="px-5 py-3 whitespace-nowrap tabular-nums text-white/50" title="{{ $log->created_at->diffForHumans() }}">{{ $log->created_at->timezone('Europe/Zurich')->format('d.m.Y H:i') }}</td>
                        <td class="px-5 py-3 whitespace-nowrap text-white">{{ $log->user?->name ?? '–' }}</td>
                        <td class="px-5 py-3 font-mono text-xs text-white/70">{{ $log->action }}</td>
                        <td class="px-5 py-3 text-white/80">{{ $log->subject }}</td>
                        <td class="px-5 py-3 text-right">
                            @if ($log->success)
                                <span class="chip text-gold"><span class="chip-dot"></span>ok</span>
                            @else
                                <span class="chip text-danger" title="{{ $log->details['error'] ?? '' }}"><span class="chip-dot"></span>fehlgeschlagen</span>
                            @endif
                        </td>
                    </tr>
                @empty
                    <tr><td colspan="5" class="muted px-5 py-12 text-center">Noch keine Einträge.</td></tr>
                @endforelse
            </tbody>
        </table>
    </div>
    <div class="mt-6">{{ $logs->links() }}</div>
</x-app>
