import { test, expect, TEST_TENANT } from '../../fixtures';

test.describe('Tenant Settings Page', () => {
  test.beforeEach(async ({ tenantSettingsPage }) => {
    await tenantSettingsPage.navigate(TEST_TENANT.slug);
  });

  test('should display tenant name and tabs', async ({ tenantSettingsPage }) => {
    await tenantSettingsPage.expectLoaded(TEST_TENANT.name);

    // Take screenshot
    await tenantSettingsPage.takeScreenshot('tenant-settings-general');
  });

  test('should have all setting tabs', async ({ tenantSettingsPage }) => {
    await tenantSettingsPage.expectLoaded();
    await tenantSettingsPage.expectHasTabs();
  });

  test('should switch between tabs', async ({ tenantSettingsPage }) => {
    await tenantSettingsPage.expectLoaded();

    // Switch to Branding tab
    await tenantSettingsPage.selectTab('Branding');
    // Verify branding content is visible
    const colorLabel = tenantSettingsPage.page.locator('text=Primary Color');
    await expect(colorLabel).toBeVisible();

    // Switch to RAG Settings tab
    await tenantSettingsPage.selectTab('RAG Settings');
    // Verify RAG config content is visible
    const topKLabel = tenantSettingsPage.page.locator('text=Top K');
    await expect(topKLabel).toBeVisible();
  });

  test('should have save button in general tab', async ({
    tenantSettingsPage,
  }) => {
    await tenantSettingsPage.expectLoaded();
    await expect(tenantSettingsPage.saveButton).toBeVisible();
  });

  test('should have delete button in header', async ({
    tenantSettingsPage,
  }) => {
    await tenantSettingsPage.expectLoaded();
    await expect(tenantSettingsPage.deleteButton).toBeVisible();
  });

  test('should have view demo button', async ({
    tenantSettingsPage,
  }) => {
    await tenantSettingsPage.expectLoaded();
    await expect(tenantSettingsPage.viewDemoButton).toBeVisible();
  });
});
