import { Page, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Landing Page Object (/)
 */
export class LandingPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ===== Locators =====

  get logo() {
    return this.page.locator('a', { hasText: 'citedQ&A' });
  }

  get heroTitle() {
    return this.page.locator('h1', { hasText: 'Cited Q&A' });
  }

  get tryDemoButton() {
    return this.page.getByRole('link', { name: 'Try Demo' });
  }

  get adminPanelButton() {
    return this.page.getByRole('link', { name: 'Admin Panel' });
  }

  get viewDemoLink() {
    return this.page.getByRole('link', { name: 'View Demo' });
  }

  get newOrganizationButton() {
    return this.page.getByRole('link', { name: '+ New Organization' });
  }

  // Nav links
  get dashboardLink() {
    return this.page.getByRole('link', { name: 'Dashboard' });
  }

  get organizationsLink() {
    return this.page.getByRole('link', { name: 'Organizations' });
  }

  get documentsLink() {
    return this.page.getByRole('link', { name: 'Documents' });
  }

  get qaLogsLink() {
    return this.page.getByRole('link', { name: 'Q&A Logs' });
  }

  // ===== Actions =====

  async navigate() {
    await this.goto('/');
    await this.waitForNetworkIdle();
  }

  async clickTryDemo() {
    await this.tryDemoButton.click();
    await this.waitForNetworkIdle();
  }

  async clickAdminPanel() {
    await this.adminPanelButton.click();
    await this.waitForNetworkIdle();
  }

  async clickViewDemo() {
    await this.viewDemoLink.click();
    await this.waitForNetworkIdle();
  }

  // ===== Assertions =====

  async expectLoaded() {
    await expect(this.heroTitle).toBeVisible();
    await expect(this.tryDemoButton).toBeVisible();
    await expect(this.adminPanelButton).toBeVisible();
  }
}
