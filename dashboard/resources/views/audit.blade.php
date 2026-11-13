<x-app title="Audit-Log">
    <h1 class="text-2xl font-semibold">Audit-Log</h1>
    <p class="mt-1 text-sm text-zinc-600">Wer hat wann was über das Dashboard geändert. Werte von Secrets werden nie gespeichert.</p>

    <div class="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table class="w-full min-w-[640px] text-left text-sm">
            <thead class="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
                <tr><th class="px-4 py-2 font-medium">Zeit</th><th class="px-4 py-2 font-medium">Person</th><th class="px-4 py-2 font-medium">Aktion</th><th class="px-4 py-2 font-medium">Betrifft</th><th class="px-4 py-2 font-medium">Ergebnis</th></tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
                @forelse ($logs as $log)
                    <tr>
                        <td class="whitespace-nowrap px-4 py-2 text-zinc-600">{{ $log->created_at->timezone('Europe/Zurich')->format('d.m.Y H:i') }}</td>
                        <td class="px-4 py-2">{{ $log->user?->name ?? '–' }}</td>
                        <td class="px-4 py-2 font-mono text-xs">{{ $log->action }}</td>
                        <td class="px-4 py-2">{{ $log->subject }}</td>
                        <td class="px-4 py-2">
                            @if ($log->success)
                                <span class="text-emerald-700">ok</span>
                            @else
                                <span class="text-red-700" title="{{ $log->details['error'] ?? '' }}">fehlgeschlagen</span>
                            @endif
                        </td>
                    </tr>
                @empty
                    <tr><td colspan="5" class="px-4 py-8 text-center text-zinc-500">Noch keine Einträge.</td></tr>
                @endforelse
            </tbody>
        </table>
    </div>
    <div class="mt-4">{{ $logs->links() }}</div>
</x-app>
