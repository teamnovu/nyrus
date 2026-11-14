<?php

use App\Http\Controllers\Auth\SsoController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DeployHookController;
use App\Http\Controllers\LogController;
use App\Http\Controllers\RepositoryController;
use App\Http\Controllers\SettingsController;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function () {
    Route::get('/login', [SsoController::class, 'login'])->name('login');
    Route::get('/sso', [SsoController::class, 'redirect'])->name('sso');
    Route::get('/sso/check', [SsoController::class, 'callback'])->name('sso.check');
    Route::post('/auth/dev', [SsoController::class, 'devLogin'])->name('auth.dev');
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [SsoController::class, 'logout'])->name('logout');

    Route::get('/', [DashboardController::class, 'index'])->name('dashboard');
    Route::get('/sessions/{id}', [DashboardController::class, 'session'])->name('sessions.show');

    Route::get('/repositories', [RepositoryController::class, 'index'])->name('repositories.index');
    Route::get('/projects', [RepositoryController::class, 'index'])->name('projects.index');
    Route::post('/repositories', [RepositoryController::class, 'store'])->name('repositories.store');
    Route::get('/projects/inbudget', [RepositoryController::class, 'inbudget'])->name('repositories.inbudget');
    Route::get('/projects/{owner}/{repo}', [RepositoryController::class, 'show'])
        ->where(['owner' => '[\w.-]+', 'repo' => '[\w.-]+'])->name('repositories.show');
    Route::post('/repositories/inbudget-sync', [RepositoryController::class, 'syncInbudget'])->name('repositories.inbudget-sync');
    Route::post('/repositories/manual', [RepositoryController::class, 'saveManual'])->name('repositories.manual');
    Route::put('/repositories/{name}', [RepositoryController::class, 'update'])->name('repositories.update');
    Route::delete('/repositories/{name}', [RepositoryController::class, 'destroy'])->name('repositories.destroy');

    Route::get('/settings', [SettingsController::class, 'index'])->name('settings.index');
    Route::post('/settings', [SettingsController::class, 'update'])->name('settings.update');

    Route::get('/logs', [LogController::class, 'index'])->name('logs.index');
    Route::get('/logs/tail', [LogController::class, 'tail'])->name('logs.tail');
    Route::get('/audit', [LogController::class, 'audit'])->name('audit.index');
});

// Called by the Forge deploy script (see README): clears PHP-FPM's OPcache.
Route::post('/_deploy/opcache-reset', [DeployHookController::class, 'resetOpcache'])
    ->withoutMiddleware([ValidateCsrfToken::class])
    ->name('deploy.opcache-reset');
