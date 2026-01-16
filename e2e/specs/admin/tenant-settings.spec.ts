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

  test('should show active status for demo tenant', async ({
    tenantSettingsPage,
  }) => {
    await tenantSettingsPage.expectLoaded();
    await tenantSettingsPage.expectStatus('active');
  });

  test('should have all setting tabs', async ({ tenantSettingsPage }) => {
    await tenantSettingsPage.expectLoaded();

    await expect(tenantSettingsPage.generalTab).toBeVisible();
    await expect(tenantSettingsPage.brandingTab).toBeVisible();
    await expect(tenantSettingsPage.aiTab).toBeVisible();
    await expect(tenantSettingsPage.advancedTab).toBeVisible();
  });

  test('should switch between tabs', async ({ tenantSettingsPage }) => {
    await tenantSettingsPage.expectLoaded();

    // Switch to Branding tab
    await tenantSettingsPage.selectTab('Branding');
    // Verify branding content is visible
    const colorLabel = tenantSettingsPage.page.locator('text=Primary Color');
    await expect(colorLabel).toBeVisible();

    // Switch to AI Configuration tab
    await tenantSettingsPage.selectTab('AI Configuration');
    // Verify AI config content is visible
    const providerLabel = tenantSettingsPage.page.locator('text=LLM Provider');
    await expect(providerLabel).toBeVisible();
  });

  test('should display back button', async ({ tenantSettingsPage, page }) => {
    await tenantSettingsPage.expectLoaded();
    await tenantSettingsPage.goBack();

    expect(page.url()).toContain('/admin/tenants');
  });

  test('should have save button in general tab', async ({
    tenantSettingsPage,
  }) => {
    await tenantSettingsPage.expectLoaded();
    await expect(tenantSettingsPage.saveButton).toBeVisible();
  });

  test('should show delete section in advanced tab', async ({
    tenantSettingsPage,
  }) => {
    await tenantSettingsPage.expectLoaded();
    await tenantSettingsPage.selectTab('Advanced');

    await expect(tenantSettingsPage.deleteSection).toBeVisible();
    await expect(tenantSettingsPage.deleteButton).toBeVisible();
  });
});
