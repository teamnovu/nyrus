<?php

use App\Services\NovuSso;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Behind Cloudflare and Nginx on Forge: trust the forwarded scheme and
        // host so generated URLs (e.g. the Google callback) use https.
        $middleware->trustProxies(at: '*');
        // Visitors without a session go straight to novu SSO (like the
        // AI-Usage-Collector); without an OAuth client, the login page explains.
        $middleware->redirectGuestsTo(fn () => route(
            app(NovuSso::class)->isConfigured() ? 'sso' : 'login'
        ));
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
