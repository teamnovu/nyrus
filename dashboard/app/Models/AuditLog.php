<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Auth;

/**
 * Who changed what in nyrus through the dashboard. Never stores secret values.
 */
#[Fillable(['user_id', 'action', 'subject', 'details', 'success'])]
class AuditLog extends Model
{
    protected function casts(): array
    {
        return [
            'details' => 'array',
            'success' => 'boolean',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @param  array<string, mixed>  $details */
    public static function record(string $action, ?string $subject, array $details = [], bool $success = true): self
    {
        return self::create([
            'user_id' => Auth::id(),
            'action' => $action,
            'subject' => $subject,
            'details' => $details,
            'success' => $success,
        ]);
    }
}
