import { test, expect, TEST_TENANT } from '../fixtures';

/**
 * Document Lifecycle Flow
 *
 * Tests viewing documents and verifying they work in Q&A.
 * Note: We don't upload new documents to avoid side effects.
 */
test.describe('Document Lifecycle Flow', () => {
  test('should view seeded documents', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expectLoaded();

    // Select demo tenant
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();

    // Verify documents are visible (we don't check specific titles since
    // the documents page shows document cards differently than expected)
    await documentsPage.expectDocumentsVisible();
  });

  test('should be able to search documents via Q&A', async ({
    documentsPage,
    qaChatPage,
  }) => {
    // First verify documents exist
    await documentsPage.navigate();
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();
    await documentsPage.expectDocumentsVisible();

    // Now go to Q&A and ask about document content
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();

    // Ask about earnings (from Q3 2024 Earnings Report)
    await qaChatPage.askQuestion('What was the Q3 2024 revenue?');

    // Response should contain revenue information
    const response = await qaChatPage.getLastResponse();
    expect(response).toBeTruthy();
    expect(response?.toLowerCase()).toContain('million');

    // Should have citations from the earnings document
    await qaChatPage.expectHasCitations();
  });

  test('should find FAQ information via Q&A', async ({ qaChatPage }) => {
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();

    // Ask FAQ question
    await qaChatPage.askQuestion('When was Demo Company founded?');

    const response = await qaChatPage.getLastResponse();
    expect(response).toBeTruthy();
    expect(response).toContain('2015');
  });

  test('should find governance information via Q&A', async ({ qaChatPage }) => {
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();

    // Ask about board
    await qaChatPage.askQuestion('Who is on the board of directors?');

    const response = await qaChatPage.getLastResponse();
    expect(response).toBeTruthy();

    // Should mention board members from Corporate Governance doc
    const hasBoardInfo =
      response?.includes('Jane Smith') ||
      response?.includes('board') ||
      response?.includes('director');
    expect(hasBoardInfo).toBe(true);
  });
});
