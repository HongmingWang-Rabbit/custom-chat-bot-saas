import { chromium, FullConfig } from '@playwright/test';
import { TEST_TENANT, ROUTES, DEFAULT_BASE_URL, TIMEOUTS } from './fixtures/test-data';

/**
 * Global Setup
 *
 * Runs once before all tests.
 * Verifies that the demo-company tenant exists and has data.
 */
async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || DEFAULT_BASE_URL;

  console.log('\n🔍 Global Setup: Verifying test data...\n');

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Check if app is running
    console.log(`  Checking app at ${baseURL}...`);
    const response = await page.goto(baseURL, { timeout: TIMEOUTS.pageLoad });

    if (!response?.ok()) {
      throw new Error(
        `App not responding at ${baseURL}. Run 'npm run dev' first.`
      );
    }
    console.log('  ✓ App is running');

    // Check if demo tenant exists
    console.log(`  Checking tenant: ${TEST_TENANT.slug}...`);
    const demoResponse = await page.goto(
      `${baseURL}${ROUTES.demo(TEST_TENANT.slug)}`,
      { timeout: TIMEOUTS.pageLoad }
    );

    if (!demoResponse?.ok()) {
      throw new Error(
        `Demo tenant '${TEST_TENANT.slug}' not found. Run 'npm run seed' first.`
      );
    }
    console.log(`  ✓ Tenant '${TEST_TENANT.slug}' exists`);

    // Check admin pages load
    console.log('  Checking admin dashboard...');
    const adminResponse = await page.goto(`${baseURL}${ROUTES.admin.dashboard}`, {
      timeout: TIMEOUTS.pageLoad,
    });

    if (!adminResponse?.ok()) {
      throw new Error('Admin dashboard not accessible.');
    }
    console.log('  ✓ Admin dashboard accessible');

    console.log('\n✅ Global setup complete. Ready to run tests.\n');
  } catch (error) {
    console.error('\n❌ Global setup failed:', (error as Error).message);
    console.error('\nMake sure to:');
    console.error('  1. Run `npm run dev` to start the server');
    console.error('  2. Run `npm run seed` to create test data\n');
    throw error;
  } finally {
    await browser.close();
  }
}

export default globalSetup;
