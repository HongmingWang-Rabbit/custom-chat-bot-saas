import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';

/**
 * Tenant Settings Page Object (/admin/tenants/[slug])
 */
export class TenantSettingsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ===== Locators =====

  get pageTitle() {
    return this.page.locator('h1');
  }

  get backButton() {
    return this.page.getByRole('link', { name: 'Back to Organizations' });
  }

  // Tabs
  get generalTab() {
    return this.page.getByRole('button', { name: 'General' });
  }

  get brandingTab() {
    return this.page.getByRole('button', { name: 'Branding' });
  }

  get aiTab() {
    return this.page.getByRole('button', { name: 'AI Configuration' });
  }

  get advancedTab() {
    return this.page.getByRole('button', { name: 'Advanced' });
  }

  // General form fields
  get nameInput() {
    return this.page.locator('input#name');
  }

  get slugDisplay() {
    return this.page.locator('input[disabled]').first();
  }

  // Status badge
  get statusBadge() {
    return this.page.locator('[class*="rounded-full"]', { hasText: /(active|provisioning|suspended|deleted)/ });
  }

  // Save button
  get saveButton() {
    return this.page.getByRole('button', { name: 'Save Changes' });
  }

  get savingButton() {
    return this.page.getByRole('button', { name: 'Saving...' });
  }

  // Delete section
  get deleteSection() {
    return this.page.locator('text=Delete Organization');
  }

  get deleteButton() {
    return this.page.getByRole('button', { name: 'Delete Organization' });
  }

  get loadingState() {
    return this.page.locator('text=Loading...');
  }

  // ===== Actions =====

  async navigate(slug: string) {
    await this.goto(`/admin/tenants/${slug}`);
    await this.waitForNetworkIdle();
  }

  async waitForLoaded() {
    await this.loadingState.waitFor({ state: 'hidden', timeout: 30000 });
  }

  async selectTab(tabName: 'General' | 'Branding' | 'AI Configuration' | 'Advanced') {
    const tabButton = this.page.getByRole('button', { name: tabName });
    await tabButton.click();
  }

  async updateName(newName: string) {
    await this.nameInput.clear();
    await this.nameInput.fill(newName);
  }

  async saveChanges() {
    await this.saveButton.click();
    // Wait for save to complete
    await this.savingButton.waitFor({ state: 'visible' });
    await this.savingButton.waitFor({ state: 'hidden' });
  }

  async goBack() {
    await this.backButton.click();
    await this.waitForNetworkIdle();
  }

  // ===== Assertions =====

  async expectLoaded(tenantName?: string) {
    await this.loadingState.waitFor({ state: 'hidden', timeout: 30000 });
    if (tenantName) {
      await expect(this.pageTitle).toContainText(tenantName);
    }
    await expect(this.generalTab).toBeVisible();
  }

  async expectTabActive(tabName: string) {
    const tabButton = this.page.getByRole('button', { name: tabName });
    await expect(tabButton).toHaveAttribute('aria-selected', 'true');
  }

  async expectStatus(status: string) {
    await expect(this.statusBadge).toContainText(status);
  }
}
