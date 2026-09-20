import { expect, type Page } from '@playwright/test';
import { LoginPage } from './login.page';
import type { SeedRole } from '../support/api';

/**
 * Page Object for the Vehicles screen (06-testing-strategy-playwright.md: no raw
 * selectors scattered in specs). Selectors use data-testid / accessible names, mirroring
 * `WarehousesPage`.
 *
 * Since LOGI-0003 the screen sits behind authentication, so `goto` signs in first.
 */
export class VehiclesPage {
  readonly page: Page;
  readonly login: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.login = new LoginPage(page);
  }

  /** Signs in as <paramref name="role"/> (default Admin) and waits for the Vehicles heading. */
  async goto(role: SeedRole = 'Admin'): Promise<void> {
    await this.login.signInAs(role);
    await this.page.getByTestId('tab-vehicles').click();
    await expect(this.page.getByRole('heading', { name: 'Vehicles' })).toBeVisible();
  }

  readonly plateInput = () => this.page.getByLabel('Vehicle plate number');
  readonly typeSelect = () => this.page.getByRole('combobox', { name: /Vehicle type/ });
  readonly capacityInput = () => this.page.getByLabel('Vehicle capacity');
  readonly statusSelect = () => this.page.getByRole('combobox', { name: /Vehicle status/ });
  readonly searchInput = () => this.page.getByLabel('Search vehicles by plate');

  // The list filters render as unnamed comboboxes (MUI never wires the aria name), so they are
  // located structurally through the FormControl that owns the InputLabel id.
  readonly statusFilter = () => this.page.locator('.MuiFormControl-root:has(#vehicle-status-label) .MuiSelect-select');
  readonly typeFilter = () => this.page.locator('.MuiFormControl-root:has(#vehicle-type-label) .MuiSelect-select');

  /** Opens a MUI Select (not a native <select>) and clicks an option in the menu. */
  private async pick(select: () => ReturnType<Page['getByRole']>, option: string): Promise<void> {
    await select().click();
    await this.page.getByRole('option', { name: option }).click();
  }

  /** Picks a vehicle type in the create/edit dialog. */
  async selectType(type: string): Promise<void> {
    await this.pick(this.typeSelect, type);
  }

  /** Picks a status in the create/edit dialog. */
  async selectStatus(status: string): Promise<void> {
    await this.pick(this.statusSelect, status);
  }

  async openCreate(): Promise<void> {
    await this.page.getByTestId('new-vehicle').click();
    await expect(this.page.getByRole('heading', { name: 'Create Vehicle' })).toBeVisible();
  }

  async openEdit(plate: string): Promise<void> {
    await this.page.getByRole('button', { name: `Edit ${plate}` }).click();
    await expect(this.page.getByRole('heading', { name: 'Edit Vehicle' })).toBeVisible();
  }

  async submitCreate(): Promise<void> {
    await this.page.getByTestId('vehicle-submit').click();
  }

  async saveEdit(): Promise<void> {
    await this.page.getByTestId('vehicle-submit').click();
  }

  /** Closes the create/edit dialog without saving. */
  async closeDialog(): Promise<void> {
    await this.page.getByTestId('vehicle-cancel').click();
  }

  async deleteRow(plate: string): Promise<void> {
    await this.page.getByRole('button', { name: `Delete ${plate}` }).click();
    await this.page.getByTestId('confirm-delete').click();
  }

  async search(plate: string): Promise<void> {
    await this.searchInput().fill(plate);
    await this.page.getByRole('button', { name: 'Search' }).click();
  }

  /** Selects a status filter (or clears all filters with ''). */
  async filterByStatus(status: string): Promise<void> {
    await this.statusFilter().click();
    await this.page.getByRole('option', { name: status === '' ? 'All statuses' : status }).click();
  }

  /** Selects a type filter (or clears all filters with ''). */
  async filterByType(type: string): Promise<void> {
    await this.typeFilter().click();
    await this.page.getByRole('option', { name: type === '' ? 'All types' : type }).click();
  }

  /** The table row containing <code>plate</code> (regex-escaped, so tokens stay exact). */
  row(plate: string): ReturnType<Page['getByRole']> {
    return this.page.getByRole('row', { name: new RegExp(plate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  }

  async expectToast(message: string): Promise<void> {
    await expect(this.page.getByTestId('snackbar')).toContainText(message);
  }

  fieldError(message: string): ReturnType<Page['getByText']> {
    return this.page.getByText(message);
  }
}
