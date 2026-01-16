import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { TIMEOUTS } from '../../fixtures/test-data';

/**
 * Admin Dashboard Page Object (/admin)
 */
export class DashboardPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ===== Locators =====

  get pageTitle() {
    return this.page.locator('h1', { hasText: 'Dashboard' });
  }

  get pageSubtitle() {
    return this.page.locator('text=Overview of your Q&A platform');
  }

  // Stat cards
  get organizationsCard() {
    return this.page.locator('[class*="rounded-xl"]', {
      hasText: 'Organizations',
    });
  }

  get documentsCard() {
    return this.page.locator('[class*="rounded-xl"]', {
      hasText: 'Total Documents',
    });
  }

  get questionsCard() {
    return this.page.locator('[class*="rounded-xl"]', {
      hasText: 'Questions Asked',
    });
  }

  get confidenceCard() {
    return this.page.locator('[class*="rounded-xl"]', {
      hasText: 'Avg. Confidence',
    });
  }

  // Quick actions
  get viewQALogsAction() {
    return this.page.getByRole('link', { name: 'View Q&A Logs' });
  }

  get uploadDocumentsAction() {
    return this.page.getByRole('link', { name: 'Upload Documents' });
  }

  get newOrganizationAction() {
    return this.page.getByRole('link', { name: 'New Organization' });
  }

  get recentActivitySection() {
    return this.page.locator('h2', { hasText: 'Recent Activity' });
  }

  get loadingSpinner() {
    return this.page.locator('text=Loading activity...');
  }

  get noActivityMessage() {
    return this.page.locator('text=No activity yet');
  }

  // ===== Actions =====

  async navigate() {
    await this.goto('/admin');
    await this.waitForNetworkIdle();
  }

  async clickViewQALogs() {
    await this.viewQALogsAction.click();
    await this.waitForNetworkIdle();
  }

  async clickUploadDocuments() {
    await this.uploadDocumentsAction.click();
    await this.waitForNetworkIdle();
  }

  async clickNewOrganization() {
    await this.newOrganizationAction.click();
    await this.waitForNetworkIdle();
  }

  /**
   * Get stat value from a card.
   */
  async getStatValue(cardLocator: Locator) {
    const valueLocator = cardLocator.locator('p.text-3xl');
    await valueLocator.waitFor();
    return valueLocator.textContent();
  }

  // ===== Assertions =====

  async expectLoaded() {
    await expect(this.pageTitle).toBeVisible();
    await expect(this.pageSubtitle).toBeVisible();
  }

  async expectStatsLoaded() {
    // Wait for loading to finish
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: TIMEOUTS.network });
    // Check stats are visible
    await expect(this.organizationsCard).toBeVisible();
    await expect(this.documentsCard).toBeVisible();
    await expect(this.questionsCard).toBeVisible();
    await expect(this.confidenceCard).toBeVisible();
  }

  async expectQuickActionsVisible() {
    await expect(this.viewQALogsAction).toBeVisible();
    await expect(this.uploadDocumentsAction).toBeVisible();
    await expect(this.newOrganizationAction).toBeVisible();
  }
}
