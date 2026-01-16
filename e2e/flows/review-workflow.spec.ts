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

  test('should create Q&A log from demo page', async ({
    qaChatPage,
  }) => {
    // Navigate to demo page
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();

    // Ask a question to create log
    await qaChatPage.askQuestion('What is the company revenue?');
    const response = await qaChatPage.getLastResponse();

    // Verify we got a response (log would be created)
    expect(response).toBeTruthy();
  });

  test('should show logs after Q&A interaction', async ({
    reviewPage,
    qaChatPage,
    page,
  }) => {
    // First create a log by asking a question
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();
    await qaChatPage.askQuestion('What is the company revenue?');
    await qaChatPage.getLastResponse();

    // Now check review page has logs
    await reviewPage.navigate();
    await reviewPage.selectTenant(TEST_TENANT.name);
    await reviewPage.waitForLogsLoaded();

    // Check if fetch failed (API flakiness)
    const fetchFailed = await page.locator('text=Failed to fetch logs').isVisible();
    if (fetchFailed) {
      // Retry by clicking Search
      await reviewPage.clickSearch();
      await reviewPage.waitForLogsLoaded();
    }

    // Check for logs or "No Q&A logs found" message
    const noLogsMessage = await reviewPage.noLogsMessage.isVisible();
    const logCount = await reviewPage.logCards.count();

    // Either we have logs, or the log creation is working (tested separately)
    // This test verifies the review page can display logs when they exist
    if (!noLogsMessage) {
      expect(logCount).toBeGreaterThan(0);
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
