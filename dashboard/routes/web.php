<?php

use App\Http\Controllers\Auth\GoogleLoginController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\LogController;
use App\Http\Controllers\RepositoryController;
use App\Http\Controllers\SettingsController;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function () {
    Route::get('/login', [GoogleLoginController::class, 'show'])->name('login');
    Route::get('/auth/google/redirect', [GoogleLoginController::class, 'redirect'])->name('auth.google');
    Route::get('/auth/google/callback', [GoogleLoginController::class, 'callback'])->name('auth.google.callback');
    Route::post('/auth/dev', [GoogleLoginController::class, 'devLogin'])->name('auth.dev');
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [GoogleLoginController::class, 'logout'])->name('logout');

    Route::get('/', [DashboardController::class, 'index'])->name('dashboard');
    Route::get('/sessions/{id}', [DashboardController::class, 'session'])->name('sessions.show');

    Route::get('/repositories', [RepositoryController::class, 'index'])->name('repositories.index');
    Route::post('/repositories', [RepositoryController::class, 'store'])->name('repositories.store');
    Route::put('/repositories/{name}', [RepositoryController::class, 'update'])->name('repositories.update');
    Route::delete('/repositories/{name}', [RepositoryController::class, 'destroy'])->name('repositories.destroy');

    Route::get('/settings', [SettingsController::class, 'index'])->name('settings.index');
    Route::post('/settings', [SettingsController::class, 'update'])->name('settings.update');

    Route::get('/logs', [LogController::class, 'index'])->name('logs.index');
    Route::get('/audit', [LogController::class, 'audit'])->name('audit.index');
});
