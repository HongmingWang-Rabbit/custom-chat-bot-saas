import { test, expect, TEST_TENANT, SEEDED_DOCUMENTS } from '../fixtures';

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

    // Verify all seeded documents are visible
    for (const doc of SEEDED_DOCUMENTS) {
      await documentsPage.expectDocumentVisible(doc.title);
    }
  });

  test('should view document details', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();

    // View first document
    const doc = SEEDED_DOCUMENTS[0];
    await documentsPage.viewDocument(doc.title);

    // Modal should show document details
    await expect(documentsPage.viewModal).toBeVisible();

    // Close modal
    await documentsPage.page.keyboard.press('Escape');
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
