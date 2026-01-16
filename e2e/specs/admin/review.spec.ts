import { test, expect, TEST_TENANT } from '../../fixtures';

test.describe('Q&A Review Page', () => {
  test.beforeEach(async ({ reviewPage }) => {
    await reviewPage.navigate();
  });

  test('should display page title and filters', async ({ reviewPage }) => {
    await reviewPage.expectLoaded();
  });

  test('should show select organization prompt initially', async ({
    reviewPage,
  }) => {
    await expect(reviewPage.selectOrgPrompt).toBeVisible();
  });

  test('should have filter controls', async ({ reviewPage }) => {
    await expect(reviewPage.tenantSearchInput).toBeVisible();
    await expect(reviewPage.flaggedFilter).toBeVisible();
    await expect(reviewPage.reviewedFilter).toBeVisible();
    await expect(reviewPage.confidenceMinInput).toBeVisible();
    await expect(reviewPage.confidenceMaxInput).toBeVisible();
    await expect(reviewPage.searchButton).toBeVisible();
  });

  test('should have AI Analyze button disabled without tenant', async ({
    reviewPage,
  }) => {
    await expect(reviewPage.aiAnalyzeButton).toBeVisible();
    await expect(reviewPage.aiAnalyzeButton).toBeDisabled();
  });

  test('should load logs after selecting tenant', async ({ reviewPage }) => {
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();

    // Take screenshot
    await reviewPage.takeScreenshot('qa-review-logs');
  });

  test('should filter by flagged status', async ({ reviewPage }) => {
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();

    // Set filter to flagged only
    await reviewPage.setFlaggedFilter('true');
    await reviewPage.clickSearch();

    // Results should be filtered (may be empty)
    await reviewPage.waitForLogsLoaded();
  });

  test('should filter by confidence range', async ({ reviewPage }) => {
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();

    // Filter low confidence only
    await reviewPage.setConfidenceRange(0, 50);
    await reviewPage.clickSearch();

    await reviewPage.waitForLogsLoaded();
  });

  test.skip('should open log detail modal on card click', async ({
    reviewPage,
  }) => {
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();

    // This test requires having Q&A logs in the database
    // Skip if no logs exist
    const cardCount = await reviewPage.logCards.count();
    if (cardCount === 0) {
      test.skip();
      return;
    }

    // Click first log card
    await reviewPage.logCards.first().click();
    await expect(reviewPage.detailModal).toBeVisible();

    // Take screenshot
    await reviewPage.takeScreenshot('qa-log-detail-modal');
  });

  test.skip('should have flag and review buttons in detail modal', async ({
    reviewPage,
  }) => {
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();

    const cardCount = await reviewPage.logCards.count();
    if (cardCount === 0) {
      test.skip();
      return;
    }

    await reviewPage.logCards.first().click();
    await expect(reviewPage.detailModal).toBeVisible();

    await expect(reviewPage.flagButton).toBeVisible();
    await expect(reviewPage.markReviewedButton).toBeVisible();
  });
});
