import { expect, type Page } from '@playwright/test';
import { LoginPage } from './login.page';
import type { SeedRole } from '../support/api';

/**
 * Page Object for the Drivers screen (LOGI-0005, mirroring `VehiclesPage`).
 * Selectors use data-testid / accessible names — no raw selectors in specs
 * (06-testing-strategy-playwright.md §Playwright conventions).
 *
 * Since LOGI-0003 the screen sits behind authentication, so `goto` signs in first.
 */
export class DriversPage {
  readonly page: Page;
  readonly login: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.login = new LoginPage(page);
  }

  /** Signs in as <role/> (default Admin) and waits for the Drivers heading. */
  async goto(role: SeedRole = 'Admin'): Promise<void> {
    await this.login.signInAs(role);
    await this.page.getByTestId('tab-drivers').click();
    await expect(this.page.getByRole('heading', { name: 'Drivers' })).toBeVisible();
  }

  readonly nameInput = () => this.page.getByLabel('Driver full name');
  readonly licenseInput = () => this.page.getByLabel('Driver license number');
  readonly phoneInput = () => this.page.getByLabel('Driver phone');
  readonly userIdInput = () => this.page.getByLabel('Driver user id');
  readonly searchInput = () => this.page.getByLabel('Search drivers by full name');

  /** The table row holding a driver id (regex-exact on the driver-row-<id> testid). */
  readonly statusFilter = () => this.page.locator('.MuiFormControl-root:has(#driver-status-label) .MuiSelect-select');

  readonly rowById = (id: number) => this.page.getByTestId(`driver-row-${id}`);

  /** Picks a status in the create/edit dialog (MUI Select, not a native <select>). */
  async selectStatus(status: string): Promise<void> {
    await this.page.getByRole('combobox', { name: /Driver status/ }).click();
    await this.page.getByRole('option', { name: status }).click();
  }

  async openCreate(): Promise<void> {
    await this.page.getByTestId('new-driver').click();
    await expect(this.page.getByRole('heading', { name: 'Create Driver' })).toBeVisible();
  }

  async openEdit(fullName: string): Promise<void> {
    await this.page.getByRole('button', { name: `Edit driver ${fullName}` }).click();
    await expect(this.page.getByRole('heading', { name: 'Edit Driver' })).toBeVisible();
  }

  async submitCreate(): Promise<void> {
    await this.page.getByTestId('driver-submit').click();
  }

  async saveEdit(): Promise<void> {
    await this.page.getByTestId('driver-submit').click();
  }

  /** Closes the create/edit dialog without saving. */
  async closeDialog(): Promise<void> {
    await this.page.getByTestId('driver-cancel').click();
  }

  async deleteRow(fullName: string): Promise<void> {
    await this.page.getByRole('button', { name: `Delete driver ${fullName}` }).click();
    await this.page.getByTestId('confirm-delete').click();
  }

  async search(name: string): Promise<void> {
    await this.searchInput().fill(name);
    await this.page.getByRole('button', { name: 'Search drivers' }).click();
  }

  /** Selects a status filter (or clears all filters with ''). */
  async filterByStatus(status: string): Promise<void> {
    await this.statusFilter().click();
    await this.page.getByRole('option', { name: status === '' ? 'All statuses' : status }).click();
  }

  /** The table row containing <name/> (regex-escaped, so tokens stay exact). */
  row(name: string): ReturnType<Page['getByRole']> {
    return this.page.getByRole('row', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  }

  async expectToast(message: string): Promise<void> {
    await expect(this.page.getByTestId('snackbar')).toContainText(message);
  }

  fieldError(message: string | RegExp): ReturnType<Page['getByText']> {
    return this.page.getByText(message);
  }
}
