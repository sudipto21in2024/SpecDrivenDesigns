import { expect, type Locator, type Page } from '@playwright/test';
import { LoginPage } from './login.page';
import type { SeedRole } from '../support/api';
import type { ShipmentStatus } from '../../../src/frontend/src/api/client';

/**
 * Page Object for the Planning Board screen (LOGI-0011).
 *
 * `data-testid` / accessible names only — no raw CSS in specs
 * (06-testing-strategy-playwright.md §Playwright conventions). The filter bar's MUI `Select`s wire an
 * InputLabel but no id the page could anchor on, so they are located through the FormControl that
 * owns their testid, exactly as `routes.page.ts` does for the route filters.
 *
 * The board is a read-only projection (AC-7), so this object deliberately exposes no write
 * affordance: every accessor here navigates, filters, sorts, switches view or loads more.
 */
export class PlanningBoardPage {
  readonly page: Page;
  readonly login: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.login = new LoginPage(page);
  }

  /** Signs in as `role` and opens the Board tab. A Driver has no such tab (AC-6). */
  async goto(role: SeedRole = 'Dispatcher'): Promise<void> {
    await this.login.signInAs(role);
    await this.tab().click();
    await this.waitForBoard();
  }

  /** Waits for the first board read to settle, whichever presentation is showing. */
  async waitForBoard(): Promise<void> {
    await expect(this.root()).toBeVisible();
    await expect(this.boardLoading()).toHaveCount(0);
    await expect(this.filters()).toBeVisible();
  }

  readonly tab = () => this.page.getByTestId('tab-board');
  readonly root = () => this.page.getByTestId('planning-board');
  readonly boardLoading = () => this.page.getByTestId('board-loading');
  readonly boardError = () => this.page.getByTestId('board-error');
  readonly filters = () => this.page.getByTestId('board-filters');
  readonly routes = () => this.page.getByTestId('board-routes');
  readonly unassignedLane = () => this.page.getByTestId('unassigned-lane');
  readonly kanbanToggle = () => this.page.getByTestId('view-kanban');
  readonly listToggle = () => this.page.getByTestId('view-list');

  /** One kanban column, and the untruncated count chip in its header (AC-1/AC-8). */
  readonly column = (status: ShipmentStatus) => this.page.getByTestId(`board-column-${status}`);
  readonly columnCount = (status: ShipmentStatus) =>
    this.page.getByTestId(`board-column-count-${status}`);
  readonly columnEmpty = (status: ShipmentStatus) => this.page.getByTestId(`board-column-empty-${status}`);
  /** "Load more" — only rendered while the column is truncated (AC-8). */
  readonly loadMore = (status: ShipmentStatus) => this.page.getByTestId(`board-load-more-${status}`);
  /** The chip that re-opens a UI-collapsed terminal column (spec §7 O2 — no second read). */
  readonly showCollapsed = (status: ShipmentStatus) => this.page.getByTestId(`board-show-${status}`);

  /**
   * The shipment cards inside a column. Anchored on `board-card-<id>` only: the card also renders
   * `board-card-ref-…`/`-risk-…`/`-unassigned-…`, so a looser `/^board-card-/` would count five
   * elements per card.
   */
  cardsIn(status: ShipmentStatus): Locator {
    return this.column(status).getByTestId(/^board-card-\d+$/);
  }

  readonly card = (id: number) => this.page.getByTestId(`board-card-${id}`);
  readonly cardRef = (id: number) => this.page.getByTestId(`board-card-ref-${id}`);
  readonly cardAtRisk = (id: number) => this.page.getByTestId(`board-card-risk-${id}`);
  readonly cardUnassigned = (id: number) => this.page.getByTestId(`board-card-unassigned-${id}`);
  readonly cardRoute = (id: number) => this.page.getByTestId(`board-card-route-${id}`);

  readonly list = () => this.page.getByTestId('board-list');
  readonly listRow = (id: number) => this.page.getByTestId(`board-list-row-${id}`);

  readonly routeCard = (id: number) => this.page.getByTestId(`board-route-${id}`);
  readonly routeCapacity = (id: number) => this.page.getByTestId(`board-route-capacity-${id}`);
  readonly routeCapacityNumbers = (id: number) =>
    this.page.getByTestId(`board-route-capacity-${id}-numbers`);
  /** AC-4's explicit "No vehicle assigned" — rendered instead of "0 kg free". */
  readonly routeCapacityUnknown = (id: number) =>
    this.page.getByTestId(`board-route-capacity-${id}-unknown`);

  // The MUI `TextField`s and `Select`s carry their `data-testid` ON the FormControl root itself, so the
  // control is that element's inner input/combobox — located by role inside the anchor, which is how
  // `routes.page.ts` reaches its selects too.
  private readonly controlIn = (testId: string): Locator => this.page.getByTestId(testId);
  readonly statusFilter = () => this.controlIn('filter-status').getByRole('combobox');
  readonly priorityFilter = () => this.controlIn('filter-priority').getByRole('combobox');
  readonly sortFilter = () => this.controlIn('filter-sort').getByRole('combobox');
  readonly routeInput = () => this.controlIn('filter-route').getByRole('spinbutton');
  readonly searchInput = () => this.controlIn('filter-q').getByRole('textbox');
  readonly slaRiskSwitch = () => this.page.getByTestId('filter-sla-risk');
  readonly clearFiltersButton = () => this.page.getByTestId('filter-clear');

  /** Resets the whole filter set in one move (AC-3) and waits for the unfiltered read to land. */
  async clearFilters(): Promise<void> {
    await this.clearFiltersButton().click();
    await this.waitForBoard();
  }

  /** Opens a MUI Select and clicks its option (the menu is portalled, so it is page-scoped). */
  private async pick(select: () => Locator, option: string): Promise<void> {
    await select().click();
    await this.page.getByRole('option', { name: option, exact: true }).click();
  }

  /** Picks the status filter — pass `'Any status'` to clear it. */
  async filterByStatus(status: string): Promise<void> {
    await this.pick(this.statusFilter, status);
    await this.waitForBoard();
  }

  async filterByPriority(priority: string): Promise<void> {
    await this.pick(this.priorityFilter, priority);
    await this.waitForBoard();
  }

  async sortBy(sortLabel: string): Promise<void> {
    await this.pick(this.sortFilter, sortLabel);
    await this.waitForBoard();
  }

  /** Types into the free-text `q` filter and waits for the re-read to settle. */
  async searchFor(text: string): Promise<void> {
    await this.searchInput().fill(text);
    await this.waitForBoard();
  }

  async filterByRouteId(routeId: number): Promise<void> {
    await this.routeInput().fill(String(routeId));
    await this.waitForBoard();
  }

  /** Switches presentation. Both are renderings of the SAME response (AC-2). */
  async showKanban(): Promise<void> {
    await this.kanbanToggle().click();
    await expect(this.column('Pending')).toBeVisible();
  }

  async showList(): Promise<void> {
    await this.listToggle().click();
    await expect(this.list()).toBeVisible();
  }

  /** Clicks "Load more" on a truncated column and waits for the wider read to land (AC-8). */
  async clickLoadMore(status: ShipmentStatus): Promise<void> {
    await this.loadMore(status).click();
    await this.waitForBoard();
  }

  /** Re-opens a UI-collapsed terminal column without triggering a second request (spec §7 O2). */
  async expandCollapsed(status: ShipmentStatus): Promise<void> {
    await this.showCollapsed(status).click();
    await expect(this.column(status)).toBeVisible();
  }

  /** Asserts a column's untruncated count chip (AC-1/AC-8 — never `cards.length`). */
  async expectColumnCount(status: ShipmentStatus, count: number): Promise<void> {
    await expect(this.columnCount(status)).toHaveText(String(count));
  }
}
