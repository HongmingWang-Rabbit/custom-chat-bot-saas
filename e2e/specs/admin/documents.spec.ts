import { test, expect, TEST_TENANT } from '../../fixtures';

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

  test('should open and close upload modal', async ({ documentsPage }) => {
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();

    await documentsPage.openUploadModal();
    await expect(documentsPage.uploadModal).toBeVisible();

    await documentsPage.closeUploadModal();
    await expect(documentsPage.uploadModal).not.toBeVisible();
  });

  test('should have upload button in upload modal', async ({ documentsPage }) => {
    await documentsPage.selectTenant(TEST_TENANT.name);
    await documentsPage.waitForDocumentsLoaded();
    await documentsPage.openUploadModal();

    // File input is hidden (styled via label), but upload button should be visible
    await expect(documentsPage.uploadSubmitButton).toBeVisible();
  });
});
