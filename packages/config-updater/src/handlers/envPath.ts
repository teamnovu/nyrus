import { join } from "node:path";

/**
 * The env file nyrus/Cyrus was started with. The CLI sets `CYRUS_ENV_FILE`
 * to the path given with `--env-file` (default `<cyrusHome>/.env`), so the
 * config API reads and writes the same file the process loads — e.g. the
 * site `.env` that Laravel Forge manages under Site → Environment.
 */
export function resolveEnvFilePath(cyrusHome: string): string {
	return process.env.CYRUS_ENV_FILE?.trim() || join(cyrusHome, ".env");
}
