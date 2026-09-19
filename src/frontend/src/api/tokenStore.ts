/**
 * Token persistence for the SPA (LOGI-0003, ADR-007).
 *
 * Tokens live in localStorage so a page reload keeps the session. This is the pragmatic v1 choice
 * recorded in ADR-007: the API is same-origin (Vite dev proxy / preview proxy), there is no
 * third-party script host in the app shell, and the access token is short-lived (15 min) with
 * single-use refresh rotation, which bounds the value of a stolen token.
 *
 * Everything goes through this module so the storage strategy can be changed in one place (e.g. to
 * httpOnly cookies) without touching feature code.
 */

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

const STORAGE_KEY = 'logiflow.auth.tokens';

/** localStorage is unavailable in some test/privacy contexts — degrade to in-memory. */
let memoryFallback: StoredTokens | null = null;

function readStorage(): StoredTokens | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return memoryFallback;
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') {
      return null;
    }
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch {
    // Corrupt or inaccessible storage must not break the app shell; treat as signed out.
    return memoryFallback;
  }
}

export const tokenStore = {
  get(): StoredTokens | null {
    return readStorage();
  },

  get accessToken(): string | null {
    return readStorage()?.accessToken ?? null;
  },

  get refreshToken(): string | null {
    return readStorage()?.refreshToken ?? null;
  },

  set(tokens: StoredTokens): void {
    memoryFallback = tokens;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } catch {
      // In-memory fallback already holds the tokens for this page lifetime.
    }
  },

  clear(): void {
    memoryFallback = null;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing else to clean up.
    }
  },
};