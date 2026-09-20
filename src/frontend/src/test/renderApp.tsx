import { render } from '@testing-library/react';
import { beforeEach } from 'vitest';
import App from '../App';
import type { Role } from '../api/client';
import { tokenStore } from '../api/tokenStore';
import { resetAuthDb, resetVehiclesDb, resetWarehousesDb, seedSession } from '../mocks/handlers';

/**
 * Shared test harness (LOGI-0003).
 *
 * Before this ticket the app rendered straight into the warehouses screen, so tests could just
 * render <App />. Now the app gates on a session, so tests must establish one — exactly as the real
 * SPA does. Doing it here (rather than in each spec) keeps the sign-in plumbing out of assertions
 * and means every suite gets a clean, deterministic session.
 */

/** Resets both mock stores. Call from a top-level `beforeEach` in the spec. */
export function resetMocks(): void {
  resetWarehousesDb();
  resetVehiclesDb();
  resetAuthDb();
  tokenStore.clear();
}

/**
 * Renders the whole app as the given role.
 *
 * The session is created through the mock's own session registry and the token is placed in the real
 * token store, so every request the app makes carries a genuine `Authorization` header and the MSW
 * role rules are actually exercised. Nothing is stubbed at the component level.
 */
export function renderAppAs(role: Role = 'Admin') {
  const { token, user } = seedSession(role);
  tokenStore.set({ accessToken: token, refreshToken: `mock-refresh-${user.id}` });
  return render(<App />);
}

/** Renders the app with no session at all, i.e. the login screen. */
export function renderAnonymousApp() {
  tokenStore.clear();
  return render(<App />);
}

/** Registers the standard per-test reset. Use in a top-level `beforeEach`. */
export function useMockReset(): void {
  beforeEach(resetMocks);
}