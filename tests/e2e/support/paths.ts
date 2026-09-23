import { resolve } from 'node:path';

/**
 * Single source of truth for the throwaway E2E database (LOGI-0013).
 *
 * The Playwright config (which starts the API) and the shipment fixtures (which seed rows while
 * creation is still LOGI-0007) must agree on one absolute path: two copies of this constant are
 * exactly how the suite would drift into "the API writes to A while a fixture seeds B".
 *
 * An absolute path keeps the API's working directory out of the picture: a relative `Data Source`
 * is resolved against the app process's CWD, which differs between a local run and CI.
 */
export const API_PROJECT = resolve(__dirname, '..', '..', '..', 'src', 'backend', 'LogiFlow.Api');
export const E2E_DB_PATH = resolve(API_PROJECT, 'e2e-logiflow.db');
