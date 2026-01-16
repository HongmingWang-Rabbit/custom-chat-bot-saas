import { test, expect } from '../fixtures';

test.describe('Landing Page', () => {
  test('should display hero section', async ({ landingPage }) => {
    await landingPage.navigate();
    await landingPage.expectLoaded();

    // Take screenshot
    await landingPage.takeScreenshot('landing-page');
  });

  test('should have navigation links', async ({ landingPage }) => {
    await landingPage.navigate();

    await expect(landingPage.dashboardLink).toBeVisible();
    await expect(landingPage.organizationsLink).toBeVisible();
    await expect(landingPage.documentsLink).toBeVisible();
    await expect(landingPage.qaLogsLink).toBeVisible();
  });

  test('should navigate to demo on Try Demo click', async ({
    landingPage,
    page,
  }) => {
    await landingPage.navigate();
    await landingPage.clickTryDemo();

    // Should be on demo page
    expect(page.url()).toContain('/demo/');
  });

  test('should navigate to admin on Admin Panel click', async ({
    landingPage,
    page,
  }) => {
    await landingPage.navigate();
    await landingPage.clickAdminPanel();

    // Should be on admin page
    expect(page.url()).toContain('/admin');
  });

  test('should navigate to demo via View Demo link', async ({
    landingPage,
    page,
  }) => {
    await landingPage.navigate();
    await landingPage.clickViewDemo();

    // Should be on demo page
    expect(page.url()).toContain('/demo/');
  });
});
