<?php

namespace App\Providers;

use App\Services\NovuSso;
use App\Services\NyrusClient;
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
        //
    }
}
