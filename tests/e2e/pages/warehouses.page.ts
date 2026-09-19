import { expect, type Page } from '@playwright/test';
import { LoginPage } from './login.page';
import type { SeedRole } from '../support/api';

/**
 * Page Object for the Warehouses screen (06-testing-strategy-playwright.md: no raw
 * selectors scattered in specs). Selectors use data-testid / accessible names.
 *
 * Since LOGI-0003 the screen sits behind authentication, so `goto` signs in first — otherwise every
 * domain spec would start by scripting the login form.
 */
export class WarehousesPage {
  readonly page: Page;
  readonly login: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.login = new LoginPage(page);
  }

  /**
   * Signs in as <paramref name="role"/> (default Admin, which holds every warehouse permission) and
   * waits for the Warehouses heading, so a spec's first action is always against a loaded page.
   */
  async goto(role: SeedRole = 'Admin'): Promise<void> {
    await this.login.signInAs(role);
    await expect(this.page.getByRole('heading', { name: 'Warehouses' })).toBeVisible();
  }

  /** Signs out through the account menu, returning to the login screen. */
  async signOut(): Promise<void> {
    await this.page.getByTestId('account-menu').click();
    await this.page.getByTestId('sign-out').click();
    await expect(this.page.getByRole('heading', { name: 'Sign in to LogiFlow' })).toBeVisible();
  }

  readonly nameInput = () => this.page.getByLabel('Warehouse name');
  readonly addressInput = () => this.page.getByLabel('Warehouse address');
  readonly latitudeInput = () => this.page.getByLabel('Warehouse latitude');
  readonly searchInput = () => this.page.getByLabel('Search by name');

  async openCreate(): Promise<void> {
    await this.page.getByTestId('new-warehouse').click();
    await expect(this.page.getByRole('heading', { name: 'Create Warehouse' })).toBeVisible();
  }

  async openEdit(name: string): Promise<void> {
    await this.page.getByRole('button', { name: `Edit warehouse ${name}` }).click();
    await expect(this.page.getByRole('heading', { name: 'Edit Warehouse' })).toBeVisible();
  }

  async submitCreate(): Promise<void> {
    await this.page.getByTestId('warehouse-submit').click();
  }

  async saveEdit(): Promise<void> {
    await this.page.getByTestId('warehouse-submit').click();
  }

  async deleteRow(name: string): Promise<void> {
    await this.page.getByRole('button', { name: `Delete warehouse ${name}` }).click();
    await this.page.getByTestId('confirm-delete').click();
  }

  async search(text: string): Promise<void> {
    await this.searchInput().fill(text);
    await this.page.getByRole('button', { name: 'Search warehouses' }).click();
  }

  /**
   * Filters the list down to <paramref name="name"/> and waits for its row to appear.
   *
   * The table is paged (5 rows per page, ordered by id) and the shared E2E database accumulates rows
   * across tests, so a seeded row may sit on a later page. Filtering server-side makes "is this row
   * here?" deterministic regardless of how much data the run has created so far.
   */
  async findRow(name: string): Promise<void> {
    await this.search(name);
    await expect(this.row(name)).toBeVisible();
  }

  row(name: string): ReturnType<Page['getByRole']> {
    return this.page.getByRole('row', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  }

  async expectToast(message: string): Promise<void> {
    await expect(this.page.getByTestId('snackbar')).toContainText(message);
  }

  fieldError(message: string): ReturnType<Page['getByText']> {
    return this.page.getByText(message);
  }
}
