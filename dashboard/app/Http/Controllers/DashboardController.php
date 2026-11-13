<?php

namespace App\Http\Controllers;

use App\Exceptions\NyrusException;
use App\Services\NyrusClient;
use Illuminate\View\View;

class DashboardController extends Controller
{
    public function index(NyrusClient $nyrus): View
    {
        $health = $nyrus->health();
        $sessions = [];
        $error = null;

        try {
            $sessions = $nyrus->sessions();
        } catch (NyrusException $e) {
            $error = $e->getMessage();
        }

        $byStatus = collect($sessions)->countBy('status');

        return view('dashboard', [
            'health' => $health,
            'sessions' => $sessions,
            'error' => $error,
            'counts' => [
                'total' => count($sessions),
                'active' => $byStatus->get('active', 0) + $byStatus->get('pending', 0),
                'awaiting' => $byStatus->get('awaitingInput', 0),
                'error' => $byStatus->get('error', 0),
            ],
        ]);
    }

    public function session(NyrusClient $nyrus, string $id): View
    {
        try {
            $data = $nyrus->session($id);
        } catch (NyrusException $e) {
            abort(404, $e->getMessage());
        }

        return view('session', $data);
    }
}
