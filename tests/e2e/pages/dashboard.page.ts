import { expect, type Locator, type Page } from '@playwright/test';
import { LoginPage } from './login.page';
import type { SeedRole } from '../support/api';
import type { ShipmentStatus } from '../../../src/frontend/src/api/client';

/**
 * Page Object for the Operations Dashboard screen (LOGI-0012).
 *
 * `data-testid` / accessible names only — no raw CSS in specs
 * (06-testing-strategy-playwright.md §Playwright conventions). The MUI `Select` controls are located
 * through their own testid and then by combobox role inside it, exactly as `planning-board.page.ts`
 * does, because MUI hides the real input behind a rendered div.
 *
 * The dashboard is a read-only projection (spec §7 O2), so this object deliberately exposes no write
 * affordance: every accessor here navigates, filters, pages or reads a drill-down target.
 */
export class DashboardPage {
  readonly page: Page;
  readonly login: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.login = new LoginPage(page);
  }

  /** Signs in as `role` and opens the Dashboard tab. A Driver has no such tab (AC-7). */
  async goto(role: SeedRole = 'Dispatcher'): Promise<void> {
    await this.login.signInAs(role);
    await this.tab().click();
    await this.waitForDashboard();
  }

  /** Waits for the first dashboard read to settle. */
  async waitForDashboard(): Promise<void> {
    await expect(this.root()).toBeVisible();
    await expect(this.loading()).toHaveCount(0);
    await expect(this.filters()).toBeVisible();
  }

  readonly tab = () => this.page.getByTestId('tab-dashboard');
  readonly root = () => this.page.getByTestId('dashboard');
  readonly loading = () => this.page.getByTestId('dashboard-loading');
  readonly error = () => this.page.getByTestId('dashboard-error');
  readonly filters = () => this.page.getByTestId('dashboard-filters');
  /** The single captured instant the whole response was evaluated at (AC-3). */
  readonly generatedAt = () => this.page.getByTestId('dashboard-generated-at');

  /** One status tile; all six are always rendered, zero counts included (AC-1). */
  readonly tile = (status: ShipmentStatus) => this.page.getByTestId(`tile-${status}`);
  readonly tileCount = (status: ShipmentStatus) => this.page.getByTestId(`tile-count-${status}`);
  readonly tileLink = (status: ShipmentStatus) => this.page.getByTestId(`tile-link-${status}`);
  /** The seventh tile — the at-risk total, which equals the pager's total by construction (AC-3). */
  readonly atRiskTile = () => this.page.getByTestId('tile-at-risk');
  readonly atRiskTileCount = () => this.page.getByTestId('tile-count-at-risk');
  readonly atRiskTileLink = () => this.page.getByTestId('tile-link-at-risk');

  /** The at-risk list and its pager (AC-2). */
  readonly atRiskPanel = () => this.page.getByTestId('at-risk-panel');
  readonly atRiskRow = (id: number) => this.page.getByTestId(`at-risk-row-${id}`);
  readonly atRiskEmpty = () => this.page.getByTestId('at-risk-empty');
  readonly atRiskPage = () => this.page.getByTestId('at-risk-page');
  readonly atRiskPrev = () => this.page.getByTestId('at-risk-prev');
  readonly atRiskNext = () => this.page.getByTestId('at-risk-next');

  /** The two utilization panels and their per-status buckets (AC-4/AC-5). */
  readonly vehiclePanel = () => this.page.getByTestId('vehicle-utilization');
  readonly vehicleTotal = () => this.page.getByTestId('vehicle-utilization-total');
  readonly vehiclePercent = () => this.page.getByTestId('vehicle-utilization-percent');
  readonly vehicleBucket = (status: string) => this.page.getByTestId(`vehicle-utilization-bucket-${status}`);
  readonly driverPanel = () => this.page.getByTestId('driver-utilization');
  readonly driverTotal = () => this.page.getByTestId('driver-utilization-total');
  readonly driverPercent = () => this.page.getByTestId('driver-utilization-percent');
  readonly driverBucket = (status: string) => this.page.getByTestId(`driver-utilization-bucket-${status}`);

  // The MUI selects carry their `data-testid` on the control ROOT, so the combobox is found inside it.
  // The numeric route filter instead puts its testid on the input itself, which already IS the
  // spinbutton — hence no inner role lookup for this one (AC-6).
  readonly statusFilter = () => this.page.getByTestId('filter-status').getByRole('combobox');
  readonly priorityFilter = () => this.page.getByTestId('filter-priority').getByRole('combobox');
  readonly routeInput = () => this.page.getByTestId('filter-route');
  readonly clearFiltersButton = () => this.page.getByTestId('filter-clear');
  /** Opens a MUI Select and clicks its option (the menu is portalled, so it is page-scoped). */
  private async pick(select: () => Locator, option: string): Promise<void> {
    await select().click();
    await this.page.getByRole('option', { name: option, exact: true }).click();
    await this.waitForDashboard();
  }

  /** Picks the status filter — pass `'All statuses'` to clear it. */
  async filterByStatus(status: string): Promise<void> {
    await this.pick(this.statusFilter, status);
  }

  async filterByPriority(priority: string): Promise<void> {
    await this.pick(this.priorityFilter, priority);
  }

  /** Types a route id into the free-text filter and waits for the re-read (AC-6). */
  async filterByRouteId(routeId: number): Promise<void> {
    await this.routeInput().fill(String(routeId));
    await this.waitForDashboard();
  }

  /** Resets the whole filter set in one move. */
  async clearFilters(): Promise<void> {
    await this.clearFiltersButton().click();
    await this.waitForDashboard();
  }

  /** Steps the at-risk pager forward (AC-2). */
  async nextAtRiskPage(): Promise<void> {
    await this.atRiskNext().click();
    await this.waitForDashboard();
  }

  /** Asserts a tile's untruncated count (AC-1 — never the page length). */
  async expectTileCount(status: ShipmentStatus, count: number): Promise<void> {
    await expect(this.tileCount(status)).toHaveText(String(count));
  }

  /**
   * The `href` a tile or bucket drills into (AC-6).
   *
   * Asserting the href rather than following it is deliberate: AC-6's claim is that every target is an
   * EXISTING endpoint with the equivalent filter, and an href states that without a second page load.
   */
  async hrefOf(locator: Locator): Promise<string> {
    return (await locator.getAttribute('href')) ?? '';
  }
}