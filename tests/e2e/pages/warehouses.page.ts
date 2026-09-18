import { expect, type Page } from '@playwright/test';

/**
 * Page Object for the Warehouses screen (06-testing-strategy-playwright.md: no raw
 * selectors scattered in specs). Selectors use data-testid / accessible names.
 */
export class WarehousesPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.getByRole('heading', { name: 'Warehouses' })).toBeVisible();
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
