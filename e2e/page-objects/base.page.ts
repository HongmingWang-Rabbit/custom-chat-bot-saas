import { Page, Locator } from '@playwright/test';
import path from 'path';
import { TIMEOUTS } from '../fixtures/test-data';

/**
 * Base Page Object
 *
 * Common methods used by all page objects.
 */
export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a path relative to base URL.
   */
  async goto(urlPath: string) {
    await this.page.goto(urlPath);
  }

  /**
   * Wait for network idle.
   */
  async waitForNetworkIdle() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Wait for element to be visible.
   */
  async waitForVisible(locator: Locator, timeout = TIMEOUTS.default) {
    await locator.waitFor({ state: 'visible', timeout });
  }

  /**
   * Wait for element to be hidden.
   */
  async waitForHidden(locator: Locator, timeout = TIMEOUTS.default) {
    await locator.waitFor({ state: 'hidden', timeout });
  }

  /**
   * Take a screenshot and save to the screenshots folder.
   * Includes timestamp to prevent overwrites across runs.
   */
  async takeScreenshot(name: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(
      process.cwd(),
      'e2e',
      'screenshots',
      `${name}-${timestamp}.png`
    );
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  /**
   * Wait for toast notification to appear.
   */
  async waitForToast(text?: string, timeout = TIMEOUTS.default) {
    const toast = this.page.locator('.Toastify__toast');
    await toast.first().waitFor({ state: 'visible', timeout });
    if (text) {
      await this.page.locator('.Toastify__toast', { hasText: text }).waitFor({ timeout });
    }
    return toast;
  }

  /**
   * Close any visible toast.
   */
  async closeToast() {
    const closeButton = this.page.locator('.Toastify__close-button');
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }
  }

  /**
   * Get the current URL path.
   */
  getPath() {
    return new URL(this.page.url()).pathname;
  }

  /**
   * Check if the page is at a specific path.
   */
  isAt(urlPath: string) {
    return this.getPath() === urlPath;
  }

  /**
   * Navigate using the nav bar.
   */
  async navTo(linkText: string) {
    await this.page.getByRole('link', { name: linkText }).click();
    await this.waitForNetworkIdle();
  }
}
