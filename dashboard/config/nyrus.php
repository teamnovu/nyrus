<?php

return [

    /*
    | nyrus runs on the same server and listens on localhost only. The
    | dashboard talks to its /status, /version and /api/* endpoints with the
    | shared CYRUS_API_KEY (the same value as in nyrus's ~/.cyrus/.env).
    */
    'url' => env('NYRUS_URL', 'http://127.0.0.1:3456'),
    'api_key' => env('NYRUS_API_KEY'),
    'timeout' => (int) env('NYRUS_TIMEOUT', 10),

    // Supervisor log of the nyrus Forge daemon (Forge shows the path).
    'log_path' => env('NYRUS_LOG_PATH'),

    // Only emails of this domain may sign in (novu SSO may also know external
    // people). Empty: everyone novu SSO vouches for.
    'allowed_domain' => env('DASHBOARD_ALLOWED_DOMAIN', 'novu.ch'),

    // Local development only: sign in without novu SSO (ignored outside "local").
    'dev_login' => (bool) env('DASHBOARD_DEV_LOGIN', false),

];
