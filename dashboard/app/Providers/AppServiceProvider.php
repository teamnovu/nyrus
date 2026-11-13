<?php

namespace App\Providers;

use App\Services\NyrusClient;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(NyrusClient::class, fn () => NyrusClient::fromConfig());
    }

    public function boot(): void
    {
        //
    }
}
