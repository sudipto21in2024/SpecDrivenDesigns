import { expect, type Locator, type Page } from '@playwright/test';
import { LoginPage } from './login.page';
import type { SeedRole } from '../support/api';

/**
 * Page Object for the Shipments screen (LOGI-0007 F5/F8, mirroring `DriversPage`/`VehiclesPage`).
 * Selectors use data-testid / accessible names — no raw selectors in specs
 * (06-testing-strategy-playwright.md §Playwright conventions).
 *
 * The screen sits behind authentication (LOGI-0003) and behind the `viewShipments` capability: the
 * Driver role sees no tab until own-route scoping lands (LOGI-0009/0010), so `goto` signs in first.
 */
export class ShipmentsPage {
  readonly page: Page;
  readonly login: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.login = new LoginPage(page);
  }

  /** Signs in as <role/> (default Admin) and opens the Shipments tab. */
  async goto(role: SeedRole = 'Admin'): Promise<void> {
    await this.login.signInAs(role);
    await this.tab().click();
    await expect(this.title()).toBeVisible();
  }

  /** Signs in without touching the tab — the role-gating assertion needs the shell as it lands. */
  async signInOnly(role: SeedRole): Promise<void> {
    await this.login.signInAs(role);
  }

  readonly title = () => this.page.getByTestId('shipments-title');
  readonly tab = () => this.page.getByTestId('tab-shipments');
  readonly newButton = () => this.page.getByTestId('new-shipment');
  readonly searchInput = () => this.page.getByLabel('Search shipments by reference or destination');
  readonly statusFilter = () => this.page.getByLabel('Filter by status');
  readonly priorityFilter = () => this.page.getByLabel('Filter by priority');
  readonly originFilter = () => this.page.getByLabel('Filter by origin warehouse');
  readonly slaRiskFilter = () => this.page.getByLabel('Filter by SLA risk');
  readonly sortFilter = () => this.page.getByLabel('Sort shipments');
  readonly table = () => this.page.getByRole('table', { name: 'Shipments table' });
  readonly emptyRow = () => this.page.getByRole('cell', { name: 'No shipments found' });
  readonly nextPage = () => this.page.getByRole('button', { name: /next page/i });
  readonly previousPage = () => this.page.getByRole('button', { name: /previous page/i });

  /** One table row, located by a text it contains (its reference code is unique per row). */
  row(text: string): Locator {
    return this.table().locator('tbody tr').filter({ hasText: text });
  }

  /** Opens the create dialog from the New shipment button. */
  async openCreate(): Promise<void> {
    await this.newButton().click();
    await expect(this.page.getByRole('heading', { name: 'Create shipment' })).toBeVisible();
  }

  /**
   * Fills the create dialog. `warehouseName` is picked from the real warehouse list the dialog loads,
   * so the caller must have seeded it first. Priority is left untouched unless supplied (it already
   * defaults to Standard, AC-3).
   */
  async fillCreate(input: {
    warehouseName: string;
    destinationAddress: string;
    weightKg: number | string;
    priority?: string;
  }): Promise<void> {
    await this.page.getByRole('combobox', { name: /Origin warehouse/ }).click();
    await this.page.getByRole('option', { name: input.warehouseName }).click();
    await this.page.getByLabel('Destination address').fill(input.destinationAddress);
    await this.page.getByLabel('Weight in kilograms').fill(String(input.weightKg));
    if (input.priority != null) {
      await this.page.getByRole('combobox', { name: /Priority/ }).click();
      await this.page.getByRole('option', { name: input.priority }).click();
    }
  }

  async submitCreate(): Promise<void> {
    await this.page.getByTestId('shipment-submit').click();
  }

  /** Creates a shipment entirely through the UI and returns the SHP-###### code the snackbar announced. */
  async createThroughDialog(input: {
    warehouseName: string;
    destinationAddress: string;
    weightKg: number | string;
    priority?: string;
  }): Promise<string> {
    await this.openCreate();
    await this.fillCreate(input);
    await this.submitCreate();
    const snackbar = this.page.getByTestId('snackbar');
    await expect(snackbar).toContainText('Shipment SHP-');
    const announced = (await snackbar.textContent()) ?? '';
    return announced.match(/SHP-\d{6}/)?.[0] ?? '';
  }

  /** Picks an option in one of the MUI filter selects (`''` is not used — pass the visible label). */
  async chooseOption(select: Locator, optionName: string): Promise<void> {
    await select.click();
    await this.page.getByRole('option', { name: optionName, exact: true }).click();
  }

  /** Submits the filter form (the typed search box only takes effect on submit). */
  async applyFilters(): Promise<void> {
    await this.page.getByRole('button', { name: 'Apply filters' }).click();
  }

  async search(text: string): Promise<void> {
    await this.searchInput().fill(text);
    await this.applyFilters();
  }

  async clearFilters(): Promise<void> {
    await this.page.getByRole('button', { name: 'Reset filters' }).click();
  }

  async expectSnackbar(message: string | RegExp): Promise<void> {
    await expect(this.page.getByTestId('snackbar')).toContainText(message);
  }
}
