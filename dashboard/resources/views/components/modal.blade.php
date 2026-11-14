{{--
    A modal <dialog>. Opened by <x-modal-button for="id">; without JavaScript
    the button loads the page with ?dialog=id and the dialog is shown. Forms in
    it send `_dialog`, so the dialog opens again after a validation error.
--}}
@props(['id', 'title', 'open' => false, 'wide' => false])
@php($reopen = old('_dialog') === $id)
@php($open = $open || $reopen || request()->query('dialog') === $id)
<dialog id="{{ $id }}" aria-labelledby="{{ $id }}-title" @if ($open) open data-dialog-autoopen @endif data-modal="{{ $id }}"
        @class(['m-auto max-w-none rounded-2xl border border-line-strong bg-surface p-0 text-white/80 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] backdrop:bg-black/70 backdrop:backdrop-blur-sm', 'w-[min(40rem,calc(100%-2rem))]' => $wide, 'w-[min(30rem,calc(100%-2rem))]' => ! $wide])>
    <div class="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div class="sticky top-0 z-10 flex items-start gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur sm:px-6">
            <h2 id="{{ $id }}-title" class="min-w-0 pt-1 text-lg">{{ $title }}</h2>
            <form method="dialog" class="ml-auto">
                <button class="btn-icon" aria-label="Schliessen"><x-icon name="x" /></button>
            </form>
        </div>
        <div class="p-5 sm:p-6">
            @if ($reopen && session('error'))
                <div class="notice mb-4 border-danger/30 !bg-inset">
                    <span class="notice-dot text-danger" aria-hidden="true"></span>
                    <span>{{ session('error') }}</span>
                </div>
            @endif
            {{ $slot }}
        </div>
    </div>
</dialog>
