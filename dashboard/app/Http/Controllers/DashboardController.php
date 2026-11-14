<?php

namespace App\Http\Controllers;

use App\Exceptions\NyrusException;
use App\Services\NyrusClient;
use App\Services\SessionList;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\View\View;

class DashboardController extends Controller
{
    private const PER_PAGE = 50;

    public function index(Request $request, NyrusClient $nyrus): View
    {
        $health = $nyrus->health();
        $sessions = [];
        $error = null;

        try {
            $sessions = $nyrus->sessions();
        } catch (NyrusException $e) {
            $error = $e->getMessage();
        }

        $sessions = array_map(fn (array $session) => $session + [
            '_source' => SessionList::source($session),
            '_state' => SessionList::state($session),
        ], array_values(array_filter($sessions, 'is_array')));

        $sources = collect($sessions)->countBy('_source')->sortKeys()->all();
        $states = collect($sessions)->countBy('_state')->all();

        $filters = [
            'source' => is_string($request->query('source')) && isset($sources[$request->query('source')]) ? $request->query('source') : '',
            'status' => is_string($request->query('status')) && isset(SessionList::STATES[$request->query('status')]) ? $request->query('status') : '',
        ];
        $matches = array_values(array_filter($sessions, fn (array $session) => ($filters['source'] === '' || $session['_source'] === $filters['source'])
            && ($filters['status'] === '' || $session['_state'] === $filters['status'])));

        $page = LengthAwarePaginator::resolveCurrentPage();
        $paginator = (new LengthAwarePaginator(
            array_slice($matches, ($page - 1) * self::PER_PAGE, self::PER_PAGE),
            count($matches),
            self::PER_PAGE,
            $page,
            ['path' => $request->url(), 'pageName' => 'page'],
        ))->withQueryString();

        return view('dashboard', [
            'health' => $health,
            'sessions' => $paginator,
            'matchCount' => count($matches),
            'filters' => $filters,
            'filtered' => $filters['source'] !== '' || $filters['status'] !== '',
            'sources' => $sources,
            'states' => $states,
            'error' => $error,
            'counts' => [
                'total' => count($sessions),
                'active' => $states['running'] ?? 0,
                'awaiting' => $states['waiting'] ?? 0,
                'error' => $states['failed'] ?? 0,
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
