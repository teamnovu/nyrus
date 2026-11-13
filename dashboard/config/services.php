<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // novu SSO (auth.novu.ch, Laravel Passport): an "OAuth Client" created
    // there, redirect URI NOVU_APP_URL + /sso/check.
    'novu_auth' => [
        'server' => env('NOVU_AUTH_SERVER', 'https://auth.novu.ch'),
        'client_id' => env('NOVU_AUTH_CLIENT_ID'),
        'client_secret' => env('NOVU_AUTH_CLIENT_SECRET'),
        'app_url' => env('NOVU_APP_URL', env('APP_URL')),
    ],

];
