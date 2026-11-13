<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Lets the Forge deploy script clear PHP-FPM's OPcache without sudo.
 *
 * With OPcache's timestamp checks off (Forge's OPcache optimization), PHP-FPM
 * keeps serving the previous release's compiled views, routes and config until
 * it restarts, while Nginx already serves the new CSS: the pages look broken.
 * The CLI cannot reset FPM's cache, so the deploy script writes a one-time
 * token file and calls this endpoint, which runs inside FPM.
 */
class DeployHookController extends Controller
{
    public const TOKEN_FILE = 'framework/opcache-reset-token';

    private const TOKEN_TTL_SECONDS = 600;

    public function resetOpcache(Request $request): JsonResponse
    {
        $file = storage_path(self::TOKEN_FILE);
        $given = (string) $request->header('X-Deploy-Token', '');

        clearstatcache(true, $file);
        $expected = is_file($file) ? trim((string) file_get_contents($file)) : '';
        $fresh = is_file($file) && time() - filemtime($file) <= self::TOKEN_TTL_SECONDS;

        if ($expected === '' || $given === '' || ! $fresh || ! hash_equals($expected, $given)) {
            abort(404);
        }

        @unlink($file);

        $reset = function_exists('opcache_reset') && opcache_reset();

        return response()->json(['opcacheReset' => $reset]);
    }
}
