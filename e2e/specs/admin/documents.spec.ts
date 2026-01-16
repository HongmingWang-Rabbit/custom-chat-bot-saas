import { test, expect, TEST_TENANT, SEEDED_DOCUMENTS } from '../../fixtures';

test.describe('Documents Page', () => {
  test.beforeEach(async ({ documentsPage }) => {
    await documentsPage.navigate();
  });

  test('should display page title and upload button', async ({
    documentsPage,
  }) => {
    await documentsPage.expectLoaded();
  });

  test('should show select organization prompt initially', async ({
    documentsPage,
  }) => {
    await expect(documentsPage.selectTenantPrompt).toBeVisible();
  });

  test('should load documents after selecting tenant', async ({
    documentsPage,
  }) => {
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.expectDocumentsVisible();

    // Take screenshot
    await documentsPage.takeScreenshot('documents-list');
  });

  test('should display seeded documents', async ({ documentsPage }) => {
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();

    // Check all seeded documents are visible
    for (const doc of SEEDED_DOCUMENTS) {
      await documentsPage.expectDocumentVisible(doc.title);
    }
  });

  test('should open and close upload modal', async ({ documentsPage }) => {
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();

    await documentsPage.openUploadModal();
    await expect(documentsPage.uploadModal).toBeVisible();

    await documentsPage.closeUploadModal();
    await expect(documentsPage.uploadModal).not.toBeVisible();
  });

  test('should have file input in upload modal', async ({ documentsPage }) => {
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();
    await documentsPage.openUploadModal();

    await expect(documentsPage.fileInput).toBeVisible();
    await expect(documentsPage.docTypeSelect).toBeVisible();
  });

  test('should open view modal on View click', async ({ documentsPage }) => {
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();

    const firstDoc = SEEDED_DOCUMENTS[0];
    await documentsPage.viewDocument(firstDoc.title);

    await expect(documentsPage.viewModal).toBeVisible();
  });

  test('should open edit modal on Edit click', async ({ documentsPage }) => {
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();

    const firstDoc = SEEDED_DOCUMENTS[0];
    await documentsPage.editDocument(firstDoc.title);

    await expect(documentsPage.editModal).toBeVisible();
  });
});
