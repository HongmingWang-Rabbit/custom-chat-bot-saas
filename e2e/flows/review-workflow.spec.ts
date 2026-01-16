import { test, expect, TEST_TENANT } from '../fixtures';

/**
 * Review Workflow Flow
 *
 * Tests the Q&A review workflow including filtering and viewing logs.
 * Note: We don't modify logs to avoid side effects (skip flag/review actions).
 */
test.describe('Review Workflow Flow', () => {
  test('should load and filter Q&A logs', async ({ reviewPage }) => {
    await reviewPage.navigate();
    await reviewPage.expectLoaded();

    // Select tenant
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();
  });

  test('should apply multiple filters', async ({ reviewPage }) => {
    await reviewPage.navigate();
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();

    // Apply confidence filter
    await reviewPage.setConfidenceRange(50, 100);

    // Set reviewed filter
    await reviewPage.setReviewedFilter('false');

    // Search
    await reviewPage.clickSearch();
    await reviewPage.waitForLogsLoaded();
  });

  test('should navigate from review to Q&A chat', async ({
    reviewPage,
    qaChatPage,
    page,
  }) => {
    // Start at review page
    await reviewPage.navigate();
    await reviewPage.expectLoaded();

    // Navigate to demo to create a log entry
    await page.goto(`/demo/${TEST_TENANT.slug}`);
    await qaChatPage.expectLoaded();

    // Ask a question to create log
    await qaChatPage.askQuestion('What is the company revenue?');
    await qaChatPage.getLastResponse();

    // Go back to review
    await reviewPage.navigate();
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();

    // Should see the new log
    const logs = await reviewPage.logCards.count();
    expect(logs).toBeGreaterThan(0);
  });

  test('should view log details from review page', async ({ reviewPage }) => {
    await reviewPage.navigate();
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();

    const logCount = await reviewPage.logCards.count();

    if (logCount > 0) {
      // Click first log
      await reviewPage.logCards.first().click();

      // Detail modal should open
      await expect(reviewPage.detailModal).toBeVisible();

      // Should show question and answer
      const questionSection = reviewPage.page.locator('text=Question');
      const answerSection = reviewPage.page.locator('text=Answer');
      await expect(questionSection).toBeVisible();
      await expect(answerSection).toBeVisible();

      // Close modal
      await reviewPage.closeLogDetail();
    }
  });

  test.skip('should flag and review logs (skip to avoid side effects)', async () => {
    // This test would modify data, so we skip it
    // In a real test environment with isolated data, you would:
    // 1. Create a test log
    // 2. Flag it
    // 3. Add review notes
    // 4. Mark as reviewed
    // 5. Verify status updates
  });
});
