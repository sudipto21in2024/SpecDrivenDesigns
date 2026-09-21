#!/usr/bin/env node
/**
 * Starts the E2E API against a *throwaway* SQLite database (LOGI-0013).
 *
 * Playwright starts webServers BEFORE globalSetup (06-testing-strategy-playwright.md §Playwright
 * conventions), so database cleanup performed in globalSetup runs while the API already holds the
 * files open. On Linux `unlink()` succeeds even then: SQLite keeps writing into deleted inodes and
 * the next physical connection re-creates an *empty* file, after which every request fails with
 * "no such table …" (HTTP 500). Windows locks open files, so the very same cleanup silently no-ops
 * locally — which is why the failure only ever showed up in CI.
 *
 * Preparing the throwaway database here — before the API starts, and never again while it runs —
 * removes that class of failure entirely.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const apiProject = resolve(here, '..', '..', 'src', 'backend', 'LogiFlow.Api');
const dbPath = process.env.E2E_DB_PATH;

if (!dbPath) {
  console.error('[e2e-api] E2E_DB_PATH is not set — playwright.config.ts must provide it.');
  process.exit(2);
}

// Safe to delete here and only here: the API is not running yet. Remove the database together with
// its write-ahead log and shared-memory file, otherwise a stale WAL would be replayed into a
// freshly created database.
for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  if (existsSync(file)) {
    rmSync(file);
    console.log(`[e2e-api] removed stale ${file}`);
  }
}

mkdirSync(dirname(dbPath), { recursive: true });
console.log(`[e2e-api] starting API against a fresh database at ${dbPath}`);

// dotnet resolves `Data Source` from playwright.config.ts as an absolute path, so the API's working
// directory cannot affect which file is used.
const child = spawn(
  'dotnet',
  ['run', '--project', '.', '-c', 'Release', '--no-build', '--urls', 'http://localhost:5199'],
  { cwd: apiProject, stdio: 'inherit', shell: process.platform === 'win32' },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

// A signal-killed API is Playwright tearing the stack down, not a startup failure.
child.on('exit', (code, signal) => process.exit(signal ? 0 : code ?? 0));
