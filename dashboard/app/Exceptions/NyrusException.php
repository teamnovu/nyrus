<?php

namespace App\Exceptions;

use RuntimeException;

/** nyrus could not be reached, rejected the request or returned an error. */
class NyrusException extends RuntimeException {}
