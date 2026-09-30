import { expect, test } from '@playwright/test';
import { RoutesPage } from './pages/routes.page';
import { seedDriver, seedVehicle, signIn } from './support/api';
import { createRoute, routeName, seedRoute, uniqueRef, window } from './support/routes';

/**
 * LOGI-0009 Routes screen seam (AC-1/AC-2/AC-3/AC-5/AC-7/AC-9 shown through the UI) on the real
 * stack — production build, real API, real SQLite, no MSW.
 *
 * The fine-grained matrix lives in the API specs and in the vitest suite; this file only proves that
 * the screen wires the same rules to a dispatcher: the create dialog persists, the edit dialog
 * assigns/unassigns, a client-side mistake never reaches the wire, a 409 double booking surfaces on
 * screen, the filters narrow the list, and read-only roles get no write affordances at all.
 */
test.describe('LOGI-0009 routes UI seam', () => {
  test('create through the dialog, then assign and unassign via Edit // LOGI-0009 AC-1 AC-2', async ({
    page,
    request,
  }) => {
    const adminToken = (await signIn(request, 'Admin')).accessToken;
    const plate = uniqueRef('UIV');
    await seedVehicle(request, adminToken, plate);
    const driverName = `Route QA ui ${routeName('UI')}`;
    await seedDriver(request, adminToken, driverName, uniqueRef('RDL'));

    const routes = new RoutesPage(page);
    const name = routeName('UI-create');
    await routes.goto('Dispatcher');
    await routes.openCreate();
    await routes.create({
      name,
      plannedStart: window(0),
      plannedEnd: window(480),
      vehicle: plate,
      driver: driverName,
    });

    await routes.expectSnackbar(`Route '${name}' created`);
    await routes.search(name);
    const row = routes.rowByName(name);
    await expect(row).toBeVisible();
    await expect(row).toContainText(plate);
    await expect(row).toContainText(driverName);
    await expect(row).toContainText('Planned');

    // AC-2 through the UI: clearing the vehicle sends the explicit null PATCH and keeps the driver.
    await routes.openEdit(name);
    await routes.unassignVehicle();
    await routes.saveEdit();
    await routes.expectSnackbar(`Route '${name}' updated`);
    const updated = routes.rowByName(name);
    await expect(updated).toContainText('Unassigned');
    await expect(updated).toContainText(driverName);
  });

  test('client-side validation blocks a blank name and a malformed or backwards window // LOGI-0009 AC-3', async ({
    page,
    request,
  }) => {
    const routes = new RoutesPage(page);
    const name = routeName('UI-invalid');
    await routes.goto('Dispatcher');
    await routes.openCreate();

    // Empty form: both required fields are flagged and nothing is sent.
    await routes.submitCreate();
    await expect(routes.fieldError('Name is required')).toBeVisible();
    await expect(routes.fieldError('Planned start is required')).toBeVisible();
    await expect(routes.fieldError('Planned end is required')).toBeVisible();

    // Unparseable instant.
    await routes.nameInput().fill(name);
    await routes.plannedStartInput().fill('not-a-date');
    await routes.plannedEndInput().fill(window(480));
    await routes.submitCreate();
    await expect(
      routes.fieldError('Enter an ISO 8601 instant, e.g. 2026-10-01T08:00:00Z'),
    ).toBeVisible();

    // plannedEnd <= plannedStart.
    await routes.plannedStartInput().fill(window(480));
    await routes.plannedEndInput().fill(window(0));
    await routes.submitCreate();
    await expect(routes.fieldError('Planned end must be after planned start')).toBeVisible();

    // The dialog is still open, i.e. nothing was persisted by a rejected submit.
    await expect(routes.dialog()).toBeVisible();
    await routes.closeDialog();
    await routes.search(name);
    await expect(routes.rowByName(name)).toHaveCount(0);
  });

  test('a BR-3/BR-4 double booking is surfaced in the dialog and keeps it open // LOGI-0009 AC-5', async ({
    page,
    request,
  }) => {
    const adminToken = (await signIn(request, 'Admin')).accessToken;
    const plate = uniqueRef('UIO');
    const vehicleId = await seedVehicle(request, adminToken, plate);

    // A Planned route already holds that vehicle for 08:00-16:00.
    const busyName = routeName('UI-busy');
    expect(
      (
        await createRoute(request, adminToken, {
          name: busyName,
          plannedStart: window(0),
          plannedEnd: window(480),
          vehicleId,
        })
      ).status,
    ).toBe(201);

    // The route under edit overlaps it (12:00-20:00).
    const targetName = routeName('UI-target');
    expect(
      (
        await createRoute(request, adminToken, {
          name: targetName,
          plannedStart: window(240),
          plannedEnd: window(720),
        })
      ).status,
    ).toBe(201);

    const routes = new RoutesPage(page);
    await routes.goto('Admin');
    await routes.search(targetName);
    await routes.openEdit(targetName);
    await routes.assignVehicle(plate);
    await routes.saveEdit();

    // The server's detail names the conflicting vehicle, and the dialog stays open on the same route.
    // (The page also shows the same detail as a transient snackbar; the dialog Alert is asserted
    // because it is non-transient, so the check cannot race the 4s auto-hide.)
    await expect(routes.dialogAlert()).toContainText(`Vehicle ${vehicleId}`);
    await expect(routes.dialog()).toBeVisible();
    await routes.closeDialog();
  });

  test('search + status filter + reset narrow and restore the list // LOGI-0009 AC-9', async ({ page, request }) => {
    const adminToken = (await signIn(request, 'Admin')).accessToken;
    const stem = routeName('UI-list');
    await seedRoute({ name: `${stem} planned`, status: 'Planned', plannedStart: window(0), plannedEnd: window(480) });
    await seedRoute({
      name: `${stem} cancelled`,
      status: 'Cancelled',
      plannedStart: window(480),
      plannedEnd: window(720),
    });

    const routes = new RoutesPage(page);
    await routes.goto('Admin');
    await routes.search(stem);
    await expect(routes.rowByName(`${stem} planned`)).toBeVisible();
    await expect(routes.rowByName(`${stem} cancelled`)).toBeVisible();

    // The status filter narrows to the terminal route; the InProgress/Planned filter excludes it.
    await routes.filterByStatus('Cancelled');
    await expect(routes.rowByName(`${stem} cancelled`)).toBeVisible();
    await expect(routes.rowByName(`${stem} planned`)).toHaveCount(0);
    await routes.filterByStatus('Planned');
    await expect(routes.rowByName(`${stem} planned`)).toBeVisible();
    await expect(routes.rowByName(`${stem} cancelled`)).toHaveCount(0);

    // Reset clears the filters, so a fresh search finds both rows again.
    await routes.resetFilters();
    await routes.search(stem);
    await expect(routes.rowByName(`${stem} planned`)).toBeVisible();
    await expect(routes.rowByName(`${stem} cancelled`)).toBeVisible();
  });

  test('Viewer and Driver get no write affordances on the Routes tab // LOGI-0009 AC-7', async ({ page, browser }) => {
    const routes = new RoutesPage(page);
    await routes.goto('Dispatcher');
    await expect(routes.newRouteButton()).toBeVisible();
    await expect(routes.actionsHeader()).toBeVisible();

    // Viewer: the tab is readable (GET /routes is allowed), but no write affordance exists.
    const viewer = new RoutesPage(await browser.newPage());
    await viewer.goto('Viewer');
    await expect(viewer.title()).toBeVisible();
    await expect(viewer.newRouteButton()).toHaveCount(0);
    await expect(viewer.actionsHeader()).toHaveCount(0);
    await viewer.page.close();

    // Driver: sees the Routes tab, must not see another driver's planning either — own-routes-only
    // scoping (spec §7 O4) leaves the list empty for an account with no driver row, and there is
    // still no write affordance.
    const driver = new RoutesPage(await browser.newPage());
    await driver.goto('Driver');
    await expect(driver.title()).toBeVisible();
    await expect(driver.newRouteButton()).toHaveCount(0);
    await expect(driver.actionsHeader()).toHaveCount(0);
    await expect(driver.page.getByText('No routes found')).toBeVisible();
    await driver.page.close();
  });
});
