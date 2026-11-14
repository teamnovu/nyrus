<?php

namespace App\Providers;

use App\Services\NovuSso;
use App\Services\NyrusClient;
use Illuminate\Support\Carbon;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(NyrusClient::class, fn () => NyrusClient::fromConfig());
        $this->app->singleton(NovuSso::class, fn () => NovuSso::fromConfig());
    }

    public function boot(): void
    {
        // The UI is German: "vor 5 Minuten", not "5 minutes ago".
        Carbon::setLocale('de');
    }
}
