<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sign-in moved from Google (Socialite) to novu SSO (auth.novu.ch), which
 * identifies people by email. The Google id is no longer needed.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('users', 'google_id')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropUnique(['google_id']);
            });
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('google_id');
            });
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('google_id')->nullable()->unique();
        });
    }
};
