/* eslint-disable react-hooks/rules-of-hooks */
import { test as base } from '@playwright/test';
import { LandingPage } from '../page-objects/landing.page';
import { DashboardPage } from '../page-objects/admin/dashboard.page';
import { TenantsPage } from '../page-objects/admin/tenants.page';
import { TenantSettingsPage } from '../page-objects/admin/tenant-settings.page';
import { DocumentsPage } from '../page-objects/admin/documents.page';
import { ReviewPage } from '../page-objects/admin/review.page';
import { QAChatPage } from '../page-objects/demo/qa-chat.page';

/**
 * Extended test with page objects.
 * Use this instead of the default Playwright test.
 *
 * Note: ESLint react-hooks rule is disabled because Playwright's `use` function
 * is not a React hook despite the naming convention.
 */
export const test = base.extend<{
  landingPage: LandingPage;
  dashboardPage: DashboardPage;
  tenantsPage: TenantsPage;
  tenantSettingsPage: TenantSettingsPage;
  documentsPage: DocumentsPage;
  reviewPage: ReviewPage;
  qaChatPage: QAChatPage;
}>({
  landingPage: async ({ page }, use) => {
    await use(new LandingPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  tenantsPage: async ({ page }, use) => {
    await use(new TenantsPage(page));
  },
  tenantSettingsPage: async ({ page }, use) => {
    await use(new TenantSettingsPage(page));
  },
  documentsPage: async ({ page }, use) => {
    await use(new DocumentsPage(page));
  },
  reviewPage: async ({ page }, use) => {
    await use(new ReviewPage(page));
  },
  qaChatPage: async ({ page }, use) => {
    await use(new QAChatPage(page));
  },
});

export { expect } from '@playwright/test';
