# Testing Strategy

## Test pyramid

| Layer | Tool | Owner | Runs on |
|---|---|---|---|
| Unit (backend) | xUnit + FluentAssertions | Backend Agent | every commit |
| Unit (frontend) | Vitest + React Testing Library | Frontend Agent | every commit |
| Contract | schema validation vs OpenAPI in CI | Backend Agent (writes), DevOps (runs) | every PR |
| E2E | Playwright (TypeScript) | QA Agent | every PR touching a feature, nightly full suite |

## Coverage gates (CI must enforce)

- Backend: ≥80% line coverage on `Application` layer (business logic), enforced via `coverlet`.
- Frontend: ≥70% on `features/` components.
- E2E: 100% of acceptance criteria in each `SPEC_APPROVED` feature file must map to at least one
  Playwright test with a comment linking the ticket id, e.g. `// LOGI-0007 AC-2`.

## Playwright conventions

- Location: `/tests/e2e/<feature-slug>.spec.ts`
- Use Page Object Model: `/tests/e2e/pages/*.page.ts` — no raw selectors scattered in specs.
- Prefer `data-testid` attributes over CSS/text selectors for stability; Frontend Agent adds
  `data-testid`s as part of implementing the UI, not as an afterthought.
- Each spec run must:
  1. Reset DB to a known seeded state (via a test-only API endpoint or a script that re-applies
     migrations + seed against a throwaway SQLite file per worker).
  2. Log in as the correct role for the scenario via an API-based auth helper (not clicking
     through the login form every test, to keep tests fast — except for the login feature itself).
  3. Assert against acceptance-criteria-level outcomes (visible text, status badges, table rows),
     not implementation details.

### Example spec skeleton

```typescript
import { test, expect } from '@playwright/test';
import { ShipmentsPage } from './pages/shipments.page';
import { loginAs, resetDatabase } from './helpers';

test.describe('LOGI-0007 Create shipment', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase();
    await loginAs(page, 'dispatcher');
  });

  test('AC-1: dispatcher can create a shipment with required fields', async ({ page }) => {
    const shipments = new ShipmentsPage(page);
    await shipments.goto();
    await shipments.openCreateForm();
    await shipments.fillForm({
      originWarehouse: 'Kolkata Hub',
      destinationAddress: '221B Park Street, Kolkata',
      weightKg: '120',
      priority: 'Express',
    });
    await shipments.submit();

    await expect(shipments.toast('Shipment created')).toBeVisible();
    await expect(shipments.rowByReference(/^SHP-/)).toBeVisible();
  });

  test('AC-2: validation error shown when weight is zero', async ({ page }) => {
    const shipments = new ShipmentsPage(page);
    await shipments.goto();
    await shipments.openCreateForm();
    await shipments.fillForm({ weightKg: '0' });
    await shipments.submit();

    await expect(shipments.fieldError('weightKg')).toContainText('greater than 0');
  });
});
```

## Environments

- CI runs Playwright against a docker-composed stack: backend (`dotnet run` in `Testing` env),
  frontend (`vite preview` build), SQLite file per test worker for isolation.
- Local dev: `npx playwright test --ui` for the QA Agent/human to debug interactively.

## Bug routing

When a Playwright test fails against `INTEGRATION_READY`, the QA Agent attaches the failing test
+ trace to the ticket and moves it to `BUG_FOUND`. It does not modify implementation code.
