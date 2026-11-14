<?php

namespace App\Services;

/**
 * Turns a session's raw entries (from nyrus' /api/dashboard/session) into
 * timeline items the session page can show by kind: the user's prompt, the
 * agent's text, a tool call with its input laid out per tool, the tool's
 * output, and the final result.
 */
class SessionTimeline
{
    /** Tools whose input is mostly a file path. */
    private const FILE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead'];

    /**
     * @param  array<int, array<string, mixed>>  $entries
     * @return array<int, array<string, mixed>>
     */
    public static function items(array $entries): array
    {
        $items = [];
        $afterTool = null;
        foreach ($entries as $entry) {
            $type = (string) ($entry['type'] ?? 'unknown');
            $tool = $entry['toolName'] ?? null;
            $content = (string) ($entry['content'] ?? '');
            $item = [
                'type' => $type,
                'content' => $content,
                'isError' => (bool) ($entry['isError'] ?? false),
                'timestamp' => $entry['timestamp'] ?? null,
                'tool' => $tool,
            ];

            if ($type === 'assistant' && $tool) {
                $items[] = $item + ['kind' => 'tool'] + self::toolInput((string) $tool, $content);
                $afterTool = $tool;

                continue;
            }
            if ($type === 'user' && $afterTool !== null) {
                $items[] = $item + ['kind' => 'output', 'forTool' => $afterTool];
                $afterTool = null;

                continue;
            }
            $afterTool = null;
            $items[] = $item + ['kind' => match ($type) {
                'user' => 'prompt',
                'assistant' => 'text',
                'result' => 'result',
                default => 'other',
            }];
        }

        return $items;
    }

    /**
     * A tool call's input: a headline (command, file, pattern...), an optional
     * caption, a body to show as code, and the remaining fields.
     *
     * @return array{headline: ?string, caption: ?string, body: ?string, bodyLabel: ?string, fields: array<string, string>, raw: ?string, diff: ?array{old: string, new: string}}
     */
    public static function toolInput(string $tool, string $content): array
    {
        $result = ['headline' => null, 'caption' => null, 'body' => null, 'bodyLabel' => null, 'fields' => [], 'raw' => null, 'diff' => null];
        $input = json_decode($content, true);
        if (! is_array($input) || array_is_list($input)) {
            return ['raw' => $content] + $result;
        }

        $take = function (string $key) use (&$input): ?string {
            $value = $input[$key] ?? null;
            unset($input[$key]);

            return is_scalar($value) ? (string) $value : null;
        };

        if ($tool === 'Bash') {
            $result['headline'] = $take('command');
            $result['caption'] = $take('description');
        } elseif (in_array($tool, self::FILE_TOOLS, true)) {
            $result['headline'] = $take('file_path') ?? $take('notebook_path') ?? $take('path');
            if (isset($input['old_string'], $input['new_string'])) {
                $result['diff'] = ['old' => (string) $take('old_string'), 'new' => (string) $take('new_string')];
            }
            if (isset($input['content'])) {
                $result['body'] = $take('content');
                $result['bodyLabel'] = 'Inhalt';
            }
        } elseif (in_array($tool, ['Grep', 'Glob'], true)) {
            $result['headline'] = $take('pattern');
            $result['caption'] = $take('path');
        } elseif (in_array($tool, ['WebFetch', 'WebSearch'], true)) {
            $result['headline'] = $take('url') ?? $take('query');
            $result['caption'] = $take('prompt');
        } elseif (in_array($tool, ['Task', 'Agent'], true)) {
            $result['headline'] = $take('description');
            $result['body'] = $take('prompt');
            $result['bodyLabel'] = 'Auftrag';
        }

        foreach ($input as $key => $value) {
            $result['fields'][(string) $key] = is_scalar($value) || $value === null
                ? (is_bool($value) ? ($value ? 'true' : 'false') : (string) $value)
                : (string) json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }

        return $result;
    }
}
