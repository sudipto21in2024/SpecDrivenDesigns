---
ticket: LOGI-0003
arm: frontend
status: done
created: 2026-09-19T18:10:00.000Z
depends_on_plans: LOGI-0003-backend
---

## 1. Objective
SPA authentication + role-gated UI per LOGI-0003 AC-12: token persistence, auth context/gate,
login page, refresh-once-retry client, role-gated warehouses screen. Implementation already
exists uncommitted (predates platform); this plan reconciles + verifies it.

## 2. Touched files (WRITE manifest — the scope boundary)
| Path | Action | Why (AC ref) | Est. lines |
|---|---|---|---|
| `src/frontend/src/App.tsx` | modify | AC-12 auth gate shell | ~100 |
| `src/frontend/src/api/client.ts` | modify | AC-12 bearer + refresh-once-retry | ~120 |
| `src/frontend/src/api/schema.d.ts` | regen | contract-sync (openapi-typescript) | ~190 |
| `src/frontend/src/api/tokenStore.ts` | create | ADR-007 localStorage strategy | ~70 |
| `src/frontend/src/features/auth/*.tsx` + `src/frontend/src/features/auth/*.ts` | create | AC-12 AuthContext/AuthGate/LoginPage + permissions | ~500 |
| `src/frontend/src/test/renderApp.tsx` | create | test harness with providers | ~80 |
| `src/frontend/src/features/warehouses/WarehousesPage.tsx` | modify | AC-12 role-gated affordances | ~40 |
| `src/frontend/src/features/warehouses/WarehousesPage.test.tsx` | modify | role scenarios | ~36 |
| `src/frontend/src/components/icons.tsx` | modify | login/user icons | ~16 |
| `src/frontend/src/mocks/handlers.ts` | modify | auth msw handlers | ~177 |

## 3. Required files (READ-ONLY scope)
| Path | Lines | What's needed |
|---|---|---|
| `specs/features/LOGI-0003-auth-roles.md` | full | AC-12 |
| `Docs/adr/007-auth-model-identity-jwt-rbac.md` | full | token storage decision |
| `src/frontend/src/api/tokenStore.ts` | full | storage contract |
| `src/frontend/src/features/auth/permissions.ts` | full | capability map |
| `src/frontend/src/api/client.ts` | full | request pipeline |

## 4. Steps (each with verify gate)
- [x] 1. tokenStore + client bearer/refresh-once-retry wiring → verify: `npm run build` (tsc) green — 2026-09-19
- [x] 2. AuthContext/AuthGate/LoginPage + role-gated WarehousesPage → verify: `npm test` green (18/18) — 2026-09-19
- [x] 3. msw auth handlers + schema regen from contract → verify: `npm test` + `npm run build` green — 2026-09-19

## 5. Risks / open questions
- `schema.d.ts` is generated from `contracts/v1-openapi.yaml`, which is itself uncommitted
  (architect artifact). Frontend commit will land before the contract commit — regenerate is
  reproducible, no drift risk.
- `localStorage` token storage is the ADR-007-recorded v1 choice (same-origin, short-lived
  access token, single-use refresh) — do not "improve" without amending the ADR.

## 6. Exit gates
- `npm test` green (18/18: 10 auth + 8 warehouse)
- `npm run build` (tsc + vite) green
- `schema.d.ts` regenerated against current `contracts/v1-openapi.yaml`