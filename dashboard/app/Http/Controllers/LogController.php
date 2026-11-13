<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use Illuminate\Http\Request;
use Illuminate\View\View;

class LogController extends Controller
{
    /** How much of the end of the log file is read at most. */
    private const MAX_BYTES = 512 * 1024;

    public function index(Request $request): View
    {
        $lines = (int) $request->integer('lines', 300);
        $lines = max(50, min($lines, 2000));
        $level = $request->string('level')->upper()->toString();
        $path = config('nyrus.log_path');

        $error = null;
        $entries = [];

        if (! $path) {
            $error = 'NYRUS_LOG_PATH ist nicht gesetzt. Den Pfad zeigt Forge beim nyrus-Daemon.';
        } elseif (! is_readable($path)) {
            $error = "Log-Datei {$path} ist nicht lesbar.";
        } else {
            $entries = $this->tail($path, $lines, in_array($level, ['INFO', 'WARN', 'ERROR', 'DEBUG'], true) ? $level : null);
        }

        return view('logs', compact('entries', 'error', 'lines', 'level', 'path'));
    }

    public function audit(): View
    {
        return view('audit', [
            'logs' => AuditLog::with('user')->latest()->paginate(50),
        ]);
    }

    /** @return list<string> */
    private function tail(string $path, int $lines, ?string $level): array
    {
        $size = filesize($path) ?: 0;
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            return [];
        }
        fseek($handle, max(0, $size - self::MAX_BYTES));
        $content = stream_get_contents($handle) ?: '';
        fclose($handle);

        $all = preg_split('/\r?\n/', $content) ?: [];
        if ($size > self::MAX_BYTES) {
            array_shift($all); // first line is probably cut off
        }
        $all = array_values(array_filter($all, fn (string $line) => trim($line) !== ''));
        if ($level !== null) {
            $all = array_values(array_filter($all, fn (string $line) => str_contains($line, "[{$level}")));
        }

        return array_slice($all, -$lines);
    }
}
