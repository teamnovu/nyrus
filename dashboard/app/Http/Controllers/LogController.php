<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\View\View;

class LogController extends Controller
{
    /** How much of the log file is read at most per request. */
    private const MAX_BYTES = 512 * 1024;

    private const LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG'];

    public function index(Request $request): View
    {
        $lines = $this->lineLimit($request);
        $level = $this->level($request);
        $path = config('nyrus.log_path');

        $error = $this->problem($path);
        $entries = [];
        $offset = 0;
        if ($error === null) {
            ['lines' => $raw, 'offset' => $offset] = $this->read($path, 0, true);
            $entries = array_map($this->parse(...), array_slice($this->filter($raw, $level), -$lines));
        }

        return view('logs', compact('entries', 'error', 'lines', 'level', 'path', 'offset'));
    }

    /**
     * New lines since byte `offset`, rendered as rows, for the live view.
     * `reset` means the file was truncated or rotated: replace everything.
     */
    public function tail(Request $request): JsonResponse
    {
        $path = config('nyrus.log_path');
        if (($error = $this->problem($path)) !== null) {
            return response()->json(['error' => $error], 503);
        }

        $level = $this->level($request);
        $offset = max(0, $request->integer('offset'));
        clearstatcache(true, $path);
        $reset = $offset > (filesize($path) ?: 0);

        ['lines' => $raw, 'offset' => $next] = $this->read($path, $reset ? 0 : $offset, $reset || $offset === 0);
        $entries = array_map($this->parse(...), array_slice($this->filter($raw, $level), -$this->lineLimit($request)));

        return response()->json([
            'reset' => $reset,
            'offset' => $next,
            'count' => count($entries),
            'html' => view('partials.log-lines', ['entries' => $entries])->render(),
        ]);
    }

    public function audit(): View
    {
        return view('audit', [
            'logs' => AuditLog::with('user')->latest()->paginate(50),
        ]);
    }

    private function problem(?string $path): ?string
    {
        if (! $path) {
            return 'NYRUS_LOG_PATH ist nicht gesetzt. Den Pfad zeigt Forge beim nyrus-Daemon.';
        }
        if (! is_readable($path)) {
            return "Log-Datei {$path} ist nicht lesbar.";
        }

        return null;
    }

    private function lineLimit(Request $request): int
    {
        return max(50, min($request->integer('lines', 300), 2000));
    }

    private function level(Request $request): string
    {
        $level = $request->string('level')->upper()->toString();

        return in_array($level, self::LEVELS, true) ? $level : '';
    }

    /**
     * Complete lines from `$from` to the end of the file (at most MAX_BYTES,
     * the newest), and the offset after the last complete line, so a line
     * still being written is picked up whole next time.
     *
     * @return array{lines: list<string>, offset: int}
     */
    private function read(string $path, int $from, bool $fromEnd): array
    {
        clearstatcache(true, $path);
        $size = filesize($path) ?: 0;
        $start = $fromEnd ? max(0, $size - self::MAX_BYTES) : max($from, $size - self::MAX_BYTES);

        $handle = fopen($path, 'rb');
        if ($handle === false) {
            return ['lines' => [], 'offset' => $from];
        }
        fseek($handle, $start);
        $content = stream_get_contents($handle, $size - $start) ?: '';
        fclose($handle);

        $lastNewline = strrpos($content, "\n");
        if ($lastNewline === false) {
            return ['lines' => [], 'offset' => $start];
        }
        $complete = substr($content, 0, $lastNewline);
        $lines = preg_split('/\r?\n/', $complete) ?: [];
        if ($start > 0 && $start !== $from) {
            array_shift($lines); // started mid-file: the first line is probably cut off
        }

        return [
            'lines' => array_values(array_filter($lines, fn (string $line) => trim($line) !== '')),
            'offset' => $start + $lastNewline + 1,
        ];
    }

    /** @param list<string> $lines @return list<string> */
    private function filter(array $lines, string $level): array
    {
        if ($level === '') {
            return $lines;
        }

        return array_values(array_filter($lines, fn (string $line) => str_contains($line, "[{$level}")));
    }

    /**
     * "2026-11-13T15:20:01.100Z [INFO ] [EdgeWorker] message" into its parts;
     * anything else is kept as a message.
     *
     * @return array{time: ?string, stamp: ?string, level: ?string, source: ?string, message: string}
     */
    private function parse(string $line): array
    {
        if (preg_match('/^(\d{4}-\d\d-\d\dT[\d:.]+Z?)\s+\[(\w+)\s*\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/', $line, $m)) {
            try {
                $time = Carbon::parse($m[1])->timezone('Europe/Zurich');
            } catch (\Throwable) {
                $time = null;
            }

            return [
                'time' => $time?->format('H:i:s'),
                'stamp' => $time?->format('d.m.Y H:i:s.v'),
                'level' => strtoupper($m[2]),
                'source' => $m[3] !== '' ? $m[3] : null,
                'message' => $m[4],
            ];
        }

        return ['time' => null, 'stamp' => null, 'level' => null, 'source' => null, 'message' => $line];
    }
}
