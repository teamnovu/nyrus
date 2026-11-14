{{-- Opens <x-modal id="…"> (a link to ?dialog=… without JavaScript). --}}
@props(['for', 'variant' => 'btn-ghost'])
<a href="{{ request()->fullUrlWithQuery(['dialog' => $for]) }}" data-dialog-open="{{ $for }}" {{ $attributes->class([$variant]) }}>{{ $slot }}</a>
