{{--
    A modal <dialog>. Opened by <x-modal-button for="id">; without JavaScript
    the button loads the page with ?dialog=id and the dialog is shown. Forms in
    it send `_dialog`, so the dialog opens again after a validation error.
--}}
@props(['id', 'title', 'open' => false, 'wide' => false])
@php($reopen = old('_dialog') === $id)
@php($open = $open || $reopen || request()->query('dialog') === $id)
<dialog id="{{ $id }}" aria-labelledby="{{ $id }}-title" @if ($open) open data-dialog-autoopen @endif data-modal="{{ $id }}"
        @class(['m-auto max-w-none rounded-xl bg-surface p-0 text-white/80 ring-1 ring-white/10 backdrop:bg-black/70 backdrop:backdrop-blur-sm', 'w-[min(40rem,calc(100%-2rem))]' => $wide, 'w-[min(30rem,calc(100%-2rem))]' => ! $wide])>
    <div class="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:p-6">
        <div class="flex items-start gap-4">
            <h2 id="{{ $id }}-title" class="min-w-0 text-lg">{{ $title }}</h2>
            <form method="dialog" class="ml-auto">
                <button class="btn-ghost !h-8 !px-2" aria-label="Schliessen">
                    <svg class="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/></svg>
                </button>
            </form>
        </div>
        @if ($reopen && session('error'))
            <div class="notice mt-4 !bg-canvas">
                <span class="notice-dot text-danger" aria-hidden="true"></span>
                <span>{{ session('error') }}</span>
            </div>
        @endif
        <div class="mt-4">{{ $slot }}</div>
    </div>
</dialog>
