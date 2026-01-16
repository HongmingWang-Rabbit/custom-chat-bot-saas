import { test, expect, TEST_TENANT } from '../../fixtures';

test.describe('Organizations Page', () => {
  test.beforeEach(async ({ tenantsPage }) => {
    await tenantsPage.navigate();
  });

  test('should display page title and new organization button', async ({
    tenantsPage,
  }) => {
    await tenantsPage.expectLoaded();
  });

  test('should display organization cards after loading', async ({
    tenantsPage,
  }) => {
    await tenantsPage.waitForOrganizationsLoaded();

    // Take screenshot
    await tenantsPage.takeScreenshot('tenants-list');

    // Demo company should be visible
    await tenantsPage.expectOrganizationVisible(TEST_TENANT.slug);
  });

  test('should show organization status badge', async ({ tenantsPage }) => {
    await tenantsPage.waitForOrganizationsLoaded();
    await tenantsPage.expectOrganizationStatus(TEST_TENANT.slug, 'active');
  });

  test('should open and close create modal', async ({ tenantsPage }) => {
    await tenantsPage.waitForOrganizationsLoaded();
    await tenantsPage.openCreateModal();

    // Take screenshot of modal
    await tenantsPage.takeScreenshot('create-organization-modal');

    await tenantsPage.closeCreateModal();
  });

  test('should validate create form inputs', async ({ tenantsPage }) => {
    await tenantsPage.waitForOrganizationsLoaded();
    await tenantsPage.openCreateModal();

    // Both fields should be required
    await expect(tenantsPage.slugInput).toHaveAttribute('required', '');
    await expect(tenantsPage.nameInput).toHaveAttribute('required', '');
  });

  test('should navigate to settings on Settings click', async ({
    tenantsPage,
    page,
  }) => {
    await tenantsPage.waitForOrganizationsLoaded();
    await tenantsPage.clickSettings(TEST_TENANT.slug);

    expect(page.url()).toContain(`/admin/tenants/${TEST_TENANT.slug}`);
  });

  test('should open demo in new tab on Open Demo click', async ({
    tenantsPage,
    context,
  }) => {
    await tenantsPage.waitForOrganizationsLoaded();

    // Get promise for new page before clicking
    const pagePromise = context.waitForEvent('page');
    await tenantsPage.clickOpenDemo(TEST_TENANT.slug);

    // Verify new tab opened with demo URL
    const newPage = await pagePromise;
    expect(newPage.url()).toContain(`/demo/${TEST_TENANT.slug}`);
    await newPage.close();
  });
});
