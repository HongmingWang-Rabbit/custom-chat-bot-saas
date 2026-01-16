import { FullConfig } from '@playwright/test';

/**
 * Global Teardown
 *
 * Runs once after all tests complete.
 * Clean up any test artifacts or resources.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function globalTeardown(_config: FullConfig) {
  console.log('\n🧹 Global Teardown: Cleaning up...\n');

  // Currently no cleanup needed as we're using existing seeded data
  // Add cleanup logic here if tests create new resources

  console.log('✅ Teardown complete.\n');
}

export default globalTeardown;
