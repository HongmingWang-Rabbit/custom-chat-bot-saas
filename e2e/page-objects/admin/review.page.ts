import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { TIMEOUTS } from '../../fixtures/test-data';

/**
 * Q&A Review Page Object (/admin/review)
 */
export class ReviewPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ===== Locators =====

  get pageTitle() {
    return this.page.locator('h1', { hasText: 'Q&A Logs' });
  }

  get pageSubtitle() {
    return this.page.locator('text=Review questions and answers');
  }

  // Filters
  get tenantSearchInput() {
    return this.page.locator('input[placeholder="Search organizations..."]');
  }

  get flaggedFilter() {
    return this.page.getByTestId('filter-flagged');
  }

  get reviewedFilter() {
    return this.page.getByTestId('filter-reviewed');
  }

  get confidenceMinInput() {
    return this.page.locator('input[placeholder="Min"]');
  }

  get confidenceMaxInput() {
    return this.page.locator('input[placeholder="Max"]');
  }

  get searchButton() {
    return this.page.getByRole('button', { name: 'Search' });
  }

  get aiAnalyzeButton() {
    return this.page.getByRole('button', { name: 'AI Analyze' });
  }

  // States
  get selectOrgPrompt() {
    return this.page.locator('text=Select an organization');
  }

  get loadingSpinner() {
    return this.page.locator('text=Loading logs...');
  }

  get noLogsMessage() {
    return this.page.locator('text=No Q&A logs found');
  }

  // Log cards
  get logCards() {
    return this.page.getByTestId('qa-log-card');
  }

  // Detail modal
  get detailModal() {
    return this.page.locator('[class*="fixed"]').filter({
      has: this.page.locator('h2', { hasText: 'Q&A Detail' }),
    });
  }

  get flagButton() {
    return this.detailModal.getByRole('button', { name: 'Flag' });
  }

  get unflagButton() {
    return this.detailModal.getByRole('button', { name: 'Unflag' });
  }

  get markReviewedButton() {
    return this.detailModal.getByRole('button', { name: 'Mark Reviewed' });
  }

  get flagReasonInput() {
    return this.detailModal.locator('textarea').first();
  }

  get reviewNotesInput() {
    return this.detailModal.locator('textarea').last();
  }

  get closeModalButton() {
    return this.detailModal.locator('button').filter({
      has: this.page.locator('svg'),
    }).first();
  }

  // Analysis modal
  get analysisModal() {
    return this.page.locator('[class*="fixed"]').filter({
      has: this.page.locator('h2', { hasText: 'AI Analysis' }),
    });
  }

  get analysisLoading() {
    return this.page.locator('text=Analyzing Q&A logs...');
  }

  // ===== Actions =====

  async navigate() {
    await this.goto('/admin/review');
    await this.waitForNetworkIdle();
  }

  async selectTenant(tenantName: string) {
    await this.tenantSearchInput.fill(tenantName);
    // Wait for dropdown to appear and click tenant
    await this.page.locator(`button:has-text("${tenantName}")`).click();
    await this.waitForNetworkIdle();
  }

  async waitForLogsLoaded() {
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: TIMEOUTS.network });
  }

  async setFlaggedFilter(value: 'all' | 'true' | 'false') {
    await this.flaggedFilter.selectOption(value);
  }

  async setReviewedFilter(value: 'all' | 'true' | 'false') {
    await this.reviewedFilter.selectOption(value);
  }

  async setConfidenceRange(min?: number, max?: number) {
    if (min !== undefined) {
      await this.confidenceMinInput.fill(min.toString());
    }
    if (max !== undefined) {
      await this.confidenceMaxInput.fill(max.toString());
    }
  }

  async clickSearch() {
    await this.searchButton.click();
    await this.waitForNetworkIdle();
  }

  async clickAIAnalyze() {
    await this.aiAnalyzeButton.click();
    await expect(this.analysisModal).toBeVisible();
  }

  /**
   * Click a log card by question text.
   */
  async openLogDetail(questionText: string) {
    const card = this.page.locator('[class*="rounded-xl"]', {
      hasText: questionText,
    });
    await card.click();
    await expect(this.detailModal).toBeVisible();
  }

  async closeLogDetail() {
    await this.closeModalButton.click();
    await expect(this.detailModal).not.toBeVisible();
  }

  async flagLog(reason?: string) {
    if (reason) {
      await this.flagReasonInput.fill(reason);
    }
    await this.flagButton.click();
    await this.waitForToast('Log flagged');
  }

  async unflagLog() {
    await this.unflagButton.click();
    await this.waitForToast('Flag removed');
  }

  async markReviewed(notes?: string) {
    if (notes) {
      await this.reviewNotesInput.fill(notes);
    }
    await this.markReviewedButton.click();
    await this.waitForToast('Marked as reviewed');
  }

  // ===== Assertions =====

  async expectLoaded() {
    await expect(this.pageTitle).toBeVisible();
    await expect(this.searchButton).toBeVisible();
  }

  async expectLogsVisible(count?: number) {
    await this.waitForLogsLoaded();
    if (count !== undefined) {
      await expect(this.logCards).toHaveCount(count);
    } else {
      await expect(this.logCards.first()).toBeVisible();
    }
  }

  async expectNoLogs() {
    await expect(this.noLogsMessage).toBeVisible();
  }

  async expectLogCardHasBadge(questionText: string, badgeText: string) {
    const card = this.page.locator('[class*="rounded-xl"]', {
      hasText: questionText,
    });
    await expect(card.locator(`text=${badgeText}`)).toBeVisible();
  }
}
