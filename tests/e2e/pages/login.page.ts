import { expect, type Page } from '@playwright/test';
import { SEED_PASSWORD, SEED_USERS, type SeedRole } from '../support/api';

/**
 * Page Object for the sign-in screen (LOGI-0003). Page objects keep selectors out of specs
 * (06-testing-strategy-playwright.md §Playwright conventions).
 */
export class LoginPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  readonly emailInput = () => this.page.getByLabel('Email');
  readonly passwordInput = () => this.page.getByLabel('Password');
  readonly signInButton = () => this.page.getByTestId('sign-in');

  /** Navigates to the app root and waits for the app shell to settle for an anonymous visitor. */
  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.getByRole('heading', { name: 'Sign in to LogiFlow' })).toBeVisible();
  }

  /**
   * Navigates to the app root as an anonymous visitor, clearing any session left behind by an
   * earlier test in the same browser context.
   *
   * localStorage is per-origin and survives navigation, so without this a test that signs in leaves
   * a valid token behind and the next test never sees the login screen. Clearing before the initial
   * navigation is the only reliable point: the store must be empty when the SPA boots.
   */
  async gotoAnonymous(): Promise<void> {
    await this.page.goto('/');
    await this.page.evaluate(() => window.localStorage.clear());
    await this.page.reload();
    await expect(this.page.getByRole('heading', { name: 'Sign in to LogiFlow' })).toBeVisible();
  }

  async signIn(role: SeedRole = 'Admin'): Promise<void> {
    await this.emailInput().fill(SEED_USERS[role]);
    await this.passwordInput().fill(SEED_PASSWORD);
    await this.signInButton().click();
  }

  /** Signs in from a clean state and waits until the authenticated shell (role chip) is on screen. */
  async signInAs(role: SeedRole = 'Admin'): Promise<void> {
    await this.gotoAnonymous();
    await this.signIn(role);
    await expect(this.page.getByTestId('current-role')).toHaveText(role);
  }

  /** The ProblemDetails message shown when credentials are rejected. */
  readonly errorAlert = () => this.page.getByRole('alert');
}