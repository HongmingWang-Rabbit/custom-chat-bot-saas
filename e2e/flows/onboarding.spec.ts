import { test, expect, TEST_TENANT } from '../fixtures';

/**
 * Onboarding Flow
 *
 * Tests the user journey from landing page to admin to creating an organization.
 * Note: We don't actually create a new org to avoid side effects.
 */
test.describe('Onboarding Flow', () => {
  test('should navigate from landing to admin dashboard', async ({
    landingPage,
    dashboardPage,
    page,
  }) => {
    // Start at landing page
    await landingPage.navigate();
    await landingPage.expectLoaded();

    // Click Admin Panel
    await landingPage.clickAdminPanel();

    // Verify we're on dashboard
    expect(page.url()).toContain('/admin');
    await dashboardPage.expectLoaded();
  });

  test('should navigate from landing to tenants to create modal', async ({
    landingPage,
    tenantsPage,
    page,
  }) => {
    // Start at landing
    await landingPage.navigate();
    await landingPage.expectLoaded();

    // Click Organizations link in nav
    await Promise.all([
      landingPage.page.waitForURL('**/admin/tenants**'),
      landingPage.organizationsLink.click(),
    ]);
    await landingPage.waitForNetworkIdle();

    // Should be on tenants page
    expect(page.url()).toContain('/admin/tenants');
    await tenantsPage.expectLoaded();

    // Open create modal
    await tenantsPage.openCreateModal();

    // Verify form is ready
    await expect(tenantsPage.slugInput).toBeVisible();
    await expect(tenantsPage.nameInput).toBeVisible();
    await expect(tenantsPage.createButton).toBeVisible();

    // Close modal without creating
    await tenantsPage.closeCreateModal();
  });

  test('should flow from dashboard quick actions to documents', async ({
    dashboardPage,
    documentsPage,
    page,
  }) => {
    await dashboardPage.navigate();
    await dashboardPage.expectLoaded();

    // Click upload documents quick action
    await dashboardPage.clickUploadDocuments();

    // Should be on documents page
    expect(page.url()).toContain('/admin/documents');
    await documentsPage.expectLoaded();
  });

  test('should flow from dashboard quick actions to Q&A logs', async ({
    dashboardPage,
    reviewPage,
    page,
  }) => {
    await dashboardPage.navigate();
    await dashboardPage.expectLoaded();

    // Click view Q&A logs quick action
    await dashboardPage.clickViewQALogs();

    // Should be on review page
    expect(page.url()).toContain('/admin/review');
    await reviewPage.expectLoaded();
  });

  test('should flow from tenants to tenant settings', async ({
    tenantsPage,
    tenantSettingsPage,
    page,
  }) => {
    await tenantsPage.navigate();
    await tenantsPage.waitForOrganizationsLoaded();

    // Click settings on demo tenant
    await tenantsPage.clickSettings(TEST_TENANT.slug);

    // Should be on settings page
    expect(page.url()).toContain(`/admin/tenants/${TEST_TENANT.slug}`);
    await tenantSettingsPage.expectLoaded(TEST_TENANT.name);
  });
});
