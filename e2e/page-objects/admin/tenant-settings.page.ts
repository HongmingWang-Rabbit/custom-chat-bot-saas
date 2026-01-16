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

  get viewDemoButton() {
    // Scope to main content to avoid matching nav link
    return this.page.getByRole('main').getByRole('link', { name: 'View Demo' });
  }

  get deleteButton() {
    return this.page.getByRole('button', { name: 'Delete' });
  }

  // Tabs (actual tabs: General, Documents, Branding, RAG Settings)
  get generalTab() {
    return this.page.getByRole('button', { name: 'General' });
  }

  get documentsTab() {
    return this.page.getByRole('button', { name: 'Documents' });
  }

  get brandingTab() {
    return this.page.getByRole('button', { name: 'Branding' });
  }

  get ragSettingsTab() {
    return this.page.getByRole('button', { name: 'RAG Settings' });
  }

  // General form fields
  get nameInput() {
    return this.page.locator('input#name');
  }

  get slugDisplay() {
    return this.page.locator('input[disabled]').first();
  }

  // Status is shown in a disabled input field, not a badge
  get statusInput() {
    return this.page.locator('input[disabled]').filter({ hasText: /active|provisioning|suspended|deleted/ });
  }

  // Save button
  get saveButton() {
    return this.page.getByRole('button', { name: 'Save Changes' });
  }

  get savingButton() {
    return this.page.getByRole('button', { name: 'Saving...' });
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

  async selectTab(tabName: 'General' | 'Documents' | 'Branding' | 'RAG Settings') {
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

  async clickDelete() {
    await this.deleteButton.click();
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

  async expectHasTabs() {
    await expect(this.generalTab).toBeVisible();
    await expect(this.documentsTab).toBeVisible();
    await expect(this.brandingTab).toBeVisible();
    await expect(this.ragSettingsTab).toBeVisible();
  }
}
