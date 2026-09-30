import { expect, type Page } from '@playwright/test';
import { LoginPage } from './login.page';
import type { SeedRole } from '../support/api';

/**
 * Page Object for the Routes screen (LOGI-0009).
 *
 * Selectors are `data-testid` / accessible names only — no raw CSS in specs
 * (06-testing-strategy-playwright.md §Playwright conventions). The list filters render MUI `Select`s
 * that never wire an accessible name, so those are located structurally through the `FormControl`
 * that owns the `InputLabel` id; the dialog selects carry their own label ids, which keeps them
 * unambiguous while a page-level filter is on screen too.
 *
 * Since LOGI-0003 the screen sits behind authentication, so `goto` signs in first.
 */
export class RoutesPage {
  readonly page: Page;
  readonly login: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.login = new LoginPage(page);
  }

  /** Signs in as `role` (default Admin) and waits for the Routes tab content. */
  async goto(role: SeedRole = 'Admin'): Promise<void> {
    await this.login.signInAs(role);
    await this.page.getByTestId('tab-routes').click();
    await expect(this.title()).toBeVisible();
  }

  readonly title = () => this.page.getByTestId('routes-title');
  readonly newRouteButton = () => this.page.getByTestId('new-route');
  readonly searchInput = () => this.page.getByLabel('Search routes by name');
  readonly searchButton = () => this.page.getByTestId('route-search');
  readonly resetButton = () => this.page.getByTestId('route-reset');
  readonly snackbar = () => this.page.getByTestId('snackbar');
  /** The Actions column header — rendered only for a role allowed to edit routes. */
  readonly actionsHeader = () => this.page.getByTestId('routes-actions-header');
  readonly dialog = () => this.page.getByRole('dialog');

  // List filters (unnamed MUI Selects → located through the owning FormControl).
  readonly statusFilter = () =>
    this.page.locator('.MuiFormControl-root:has(#route-status-filter) .MuiSelect-select');
  readonly vehicleFilter = () =>
    this.page.locator('.MuiFormControl-root:has(#route-vehicle-filter) .MuiSelect-select');
  readonly driverFilter = () =>
    this.page.locator('.MuiFormControl-root:has(#route-driver-filter) .MuiSelect-select');

  // Dialog fields.
  readonly nameInput = () => this.page.getByLabel('Route name');
  readonly plannedStartInput = () => this.page.getByLabel('Planned start');
  readonly plannedEndInput = () => this.page.getByLabel('Planned end');
  readonly createVehicleSelect = () =>
    this.page.locator('.MuiFormControl-root:has(#route-vehicle-label) .MuiSelect-select');
  readonly createDriverSelect = () =>
    this.page.locator('.MuiFormControl-root:has(#route-driver-label) .MuiSelect-select');
  readonly editVehicleSelect = () =>
    this.page.locator('.MuiFormControl-root:has(#route-edit-vehicle-label) .MuiSelect-select');
  readonly editDriverSelect = () =>
    this.page.locator('.MuiFormControl-root:has(#route-edit-driver-label) .MuiSelect-select');

  /** Opens a MUI Select and clicks its option (the menu is portalled, so it is page-scoped). */
  private async pick(select: () => ReturnType<Page['locator']>, option: string): Promise<void> {
    await select().click();
    await this.page.getByRole('option', { name: option, exact: true }).click();
  }

  readonly rowById = (id: number) => this.page.getByTestId(`route-row-${id}`);
  /** The table row whose accessible name contains `name` (regex-escaped, so tokens stay exact). */
  readonly rowByName = (name: string) =>
    this.page.getByRole('row', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  readonly editButton = (name: string) => this.page.getByRole('button', { name: `Edit ${name}` });

  async openCreate(): Promise<void> {
    await this.newRouteButton().click();
    await expect(this.page.getByRole('heading', { name: 'Create route' })).toBeVisible();
  }

  /** Submits the create dialog as it stands (used to provoke client-side validation). */
  async submitCreate(): Promise<void> {
    await this.page.getByTestId('route-submit').click();
  }

  /** Fills and submits the create dialog. An omitted vehicle/driver stays `Unassigned`. */
  async create(input: {
    name: string;
    plannedStart: string;
    plannedEnd: string;
    vehicle?: string;
    driver?: string;
  }): Promise<void> {
    await this.nameInput().fill(input.name);
    await this.plannedStartInput().fill(input.plannedStart);
    await this.plannedEndInput().fill(input.plannedEnd);
    if (input.vehicle) await this.pick(this.createVehicleSelect, input.vehicle);
    if (input.driver) await this.pick(this.createDriverSelect, input.driver);
    await this.page.getByTestId('route-submit').click();
  }

  async openEdit(name: string): Promise<void> {
    await this.editButton(name).click();
    await expect(this.page.getByRole('heading', { name: 'Edit route' })).toBeVisible();
  }

  /** Saves the edit dialog (the PATCH carries only the fields that changed). */
  async saveEdit(): Promise<void> {
    await this.page.getByTestId('route-save').click();
  }

  async assignVehicle(plate: string): Promise<void> {
    await this.pick(this.editVehicleSelect, plate);
  }

  async assignDriver(fullName: string): Promise<void> {
    await this.pick(this.editDriverSelect, fullName);
  }

  /** Selects the "Unassigned" sentinel — i.e. the explicit `null` PATCH that clears an assignment. */
  async unassignVehicle(): Promise<void> {
    await this.pick(this.editVehicleSelect, 'Unassigned');
  }

  /** Closes the open dialog without saving. */
  async closeDialog(): Promise<void> {
    await this.dialog().getByRole('button', { name: 'Cancel' }).click();
    await expect(this.dialog()).toHaveCount(0);
  }

  async search(text: string): Promise<void> {
    await this.searchInput().fill(text);
    await this.searchButton().click();
  }

  async resetFilters(): Promise<void> {
    await this.resetButton().click();
  }

  /** Picks a status filter option — pass `'All statuses'` to clear it. */
  async filterByStatus(status: string): Promise<void> {
    await this.pick(this.statusFilter, status);
  }

  async expectSnackbar(text: string | RegExp): Promise<void> {
    await expect(this.snackbar()).toContainText(text);
  }

  /** A field/validation message rendered by a dialog (helper text or server field mapping). */
  fieldError(text: string | RegExp): ReturnType<Page['getByText']> {
    return this.dialog().getByText(text);
  }

  /** The dialog's own error Alert (a 409/404 detail — never the list-level load error). */
  dialogAlert(): ReturnType<Page['getByRole']> {
    return this.dialog().getByRole('alert');
  }

  // ------------------------------------------------ Shipments panel (LOGI-0010)

  /** The "Shipments" row action for a route id (readable by every role that may read routes). */
  readonly shipmentsButton = (routeId: number) => this.page.getByTestId(`route-shipments-${routeId}`);
  readonly shipmentsPanel = () => this.page.getByTestId('route-shipments-panel');
  readonly capacityBanner = () => this.page.getByTestId('capacity-banner');
  /** "100 kg remaining of 1000 kg capacity" — present only when the route has a vehicle. */
  readonly capacityNumbers = () => this.page.getByTestId('capacity-numbers');
  /** The "capacity not checked" note, shown for a route with no vehicle (nulls, not 0). */
  readonly capacityUnknown = () => this.page.getByTestId('capacity-unknown');
  readonly assignSelect = () => this.page.getByLabel('Shipment to assign');
  readonly assignButton = () => this.page.getByTestId('assign-shipment');
  readonly unassignButton = (shipmentId: number) => this.page.getByTestId(`unassign-shipment-${shipmentId}`);
  readonly shipmentRow = (shipmentId: number) => this.page.getByTestId(`route-shipment-${shipmentId}`);
  readonly emptyShipments = () => this.page.getByTestId('route-shipments-empty');
  /** The panel's own error Alert (a 409 capacity/status detail). */
  readonly panelAlert = () => this.page.getByTestId('panel-error');
  /** The read-only reason shown to a writer when the route is not Planned. */
  readonly readOnlyReason = () => this.page.getByTestId('panel-readonly-reason');

  /** Opens the Shipments panel for `routeId` and waits for its first read to settle. */
  async openShipments(routeId: number): Promise<void> {
    await this.shipmentsButton(routeId).click();
    await expect(this.shipmentsPanel()).toBeVisible();
    await expect(this.shipmentsPanel().getByText('Loading shipments…')).toHaveCount(0);
  }

  /**
   * Assigns `reference` through the candidate select. The option label is
   * "<REFERENCE> — <weight> kg", so the reference alone is enough to pick it.
   */
  async assignShipment(reference: string): Promise<void> {
    await this.assignSelect().click();
    await this.page.getByRole('option', { name: new RegExp(reference) }).click();
    await this.assignButton().click();
  }

  async unassignShipment(shipmentId: number): Promise<void> {
    await this.unassignButton(shipmentId).click();
  }

  async closeShipments(): Promise<void> {
    await this.page.getByTestId('close-route-shipments').click();
    await expect(this.shipmentsPanel()).toHaveCount(0);
  }

  /** Asserts the panel's error Alert carries `text` (the server's ProblemDetails detail). */
  async expectPanelError(text: string | RegExp): Promise<void> {
    await expect(this.panelAlert()).toContainText(text);
  }
}
