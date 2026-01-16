import { test, expect } from '../../fixtures';

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ dashboardPage }) => {
    await dashboardPage.navigate();
  });

  test('should display page title and subtitle', async ({ dashboardPage }) => {
    await dashboardPage.expectLoaded();
  });

  test('should display stats cards', async ({ dashboardPage }) => {
    await dashboardPage.expectStatsLoaded();

    // Verify stats have values
    const orgValue = await dashboardPage.getStatValue(
      dashboardPage.organizationsCard
    );
    expect(orgValue).toBeTruthy();

    // Take screenshot
    await dashboardPage.takeScreenshot('dashboard-with-stats');
  });

  test('should display quick actions', async ({ dashboardPage }) => {
    await dashboardPage.expectQuickActionsVisible();
  });

  test('should navigate to Q&A logs on quick action click', async ({
    dashboardPage,
    page,
  }) => {
    await dashboardPage.expectLoaded();
    await dashboardPage.clickViewQALogs();

    expect(page.url()).toContain('/admin/review');
  });

  test('should navigate to documents on quick action click', async ({
    dashboardPage,
    page,
  }) => {
    await dashboardPage.expectLoaded();
    await dashboardPage.clickUploadDocuments();

    expect(page.url()).toContain('/admin/documents');
  });

  test('should navigate to tenants on quick action click', async ({
    dashboardPage,
    page,
  }) => {
    await dashboardPage.expectLoaded();
    await dashboardPage.clickNewOrganization();

    expect(page.url()).toContain('/admin/tenants');
  });

  test('should display recent activity section', async ({ dashboardPage }) => {
    await expect(dashboardPage.recentActivitySection).toBeVisible();
  });
});
