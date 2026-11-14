<x-app title="Audit-Log">
    <p class="eyebrow">Betrieb</p>
    <h1 class="page-title">Audit-Log</h1>
    <p class="page-lead">Wer hat wann was über das Dashboard geändert. Werte von Secrets werden nie gespeichert.</p>

    <div class="card mt-8 overflow-x-auto">
        <table class="w-full min-w-[680px] text-left text-sm">
            <thead class="bg-raised text-xs text-white/50">
                <tr class="border-b border-line">
                    <th class="px-5 py-3 font-medium">Zeit</th>
                    <th class="px-5 py-3 font-medium">Person</th>
                    <th class="px-5 py-3 font-medium">Aktion</th>
                    <th class="px-5 py-3 font-medium">Betrifft</th>
                    <th class="px-5 py-3 text-right font-medium">Ergebnis</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-line">
                @forelse ($logs as $log)
                    <tr class="card-row">
                        <td class="px-5 py-3 whitespace-nowrap text-white/60 tabular-nums" title="{{ $log->created_at->diffForHumans() }}">{{ $log->created_at->timezone('Europe/Zurich')->format('d.m.Y H:i') }}</td>
                        <td class="px-5 py-3 whitespace-nowrap text-white">
                            <span class="flex items-center gap-2">
                                <span class="flex size-6 items-center justify-center rounded-full bg-white/[0.08] text-[11px] font-semibold text-white/75" aria-hidden="true">{{ mb_strtoupper(mb_substr($log->user?->name ?? '?', 0, 1)) }}</span>
                                {{ $log->user?->name ?? '–' }}
                            </span>
                        </td>
                        <td class="px-5 py-3"><span class="rounded-md border border-line bg-inset px-1.5 py-0.5 font-mono text-xs text-white/75">{{ $log->action }}</span></td>
                        <td class="px-5 py-3 text-white/85">{{ $log->subject }}</td>
                        <td class="px-5 py-3 text-right">
                            @if ($log->success)
                                <span class="chip chip-status text-success"><span class="chip-dot"></span>ok</span>
                            @else
                                <span class="chip chip-status text-danger" title="{{ $log->details['error'] ?? '' }}"><span class="chip-dot"></span>fehlgeschlagen</span>
                            @endif
                        </td>
                    </tr>
                @empty
                    <tr><td colspan="5" class="px-5 py-14 text-center"><x-icon name="inbox" class="mx-auto size-8 text-white/20" /><p class="muted mt-3">Noch keine Einträge.</p></td></tr>
                @endforelse
            </tbody>
        </table>
    </div>
    <div class="mt-6">@include('partials.pagination', ['paginator' => $logs])</div>
</x-app>
