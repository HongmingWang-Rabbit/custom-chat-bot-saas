import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { TIMEOUTS } from '../../fixtures/test-data';

/**
 * Tenants/Organizations Page Object (/admin/tenants)
 */
export class TenantsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ===== Locators =====

  get pageTitle() {
    return this.page.locator('h1', { hasText: 'Organizations' });
  }

  get pageSubtitle() {
    return this.page.locator('text=Manage tenant organizations');
  }

  get newOrganizationButton() {
    return this.page.getByRole('button', { name: '+ New Organization' });
  }

  get organizationCards() {
    return this.page.locator('[class*="rounded-xl"][class*="border-gray-200"]').filter({
      has: this.page.locator('h3'),
    });
  }

  get loadingSpinner() {
    return this.page.locator('text=Loading organizations...');
  }

  get emptyState() {
    return this.page.locator('text=No organizations yet');
  }

  // Create modal
  get createModal() {
    return this.page.locator('[class*="fixed"]').filter({
      has: this.page.locator('h2', { hasText: 'Create Organization' }),
    });
  }

  get slugInput() {
    return this.page.locator('input[placeholder="acme-corp"]');
  }

  get nameInput() {
    return this.page.locator('input[placeholder="Acme Corporation"]');
  }

  get cancelButton() {
    return this.page.getByRole('button', { name: 'Cancel' });
  }

  get createButton() {
    return this.page.getByRole('button', { name: 'Create Organization' });
  }

  get provisioningButton() {
    return this.page.getByRole('button', { name: 'Provisioning...' });
  }

  get provisioningStatus() {
    return this.page.locator('text=Creating Supabase project');
  }

  // ===== Actions =====

  async navigate() {
    await this.goto('/admin/tenants');
    await this.waitForNetworkIdle();
  }

  async waitForOrganizationsLoaded() {
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: TIMEOUTS.network });
  }

  async openCreateModal() {
    await this.newOrganizationButton.click();
    await expect(this.createModal).toBeVisible();
  }

  async closeCreateModal() {
    await this.cancelButton.click();
    await expect(this.createModal).not.toBeVisible();
  }

  async fillCreateForm(slug: string, name: string) {
    await this.slugInput.fill(slug);
    await this.nameInput.fill(name);
  }

  async submitCreateForm() {
    await this.createButton.click();
  }

  /**
   * Get organization card by slug.
   */
  getOrganizationCard(slug: string) {
    return this.page.locator('[class*="rounded-xl"]', { hasText: slug });
  }

  /**
   * Click Open Demo on a tenant card.
   */
  async clickOpenDemo(slug: string) {
    const card = this.getOrganizationCard(slug);
    await card.getByRole('link', { name: 'Open Demo' }).click();
  }

  /**
   * Click Settings on a tenant card.
   */
  async clickSettings(slug: string) {
    const card = this.getOrganizationCard(slug);
    await card.getByRole('link', { name: 'Settings' }).click();
    await this.waitForNetworkIdle();
  }

  /**
   * Get tenant status badge text.
   */
  async getTenantStatus(slug: string) {
    const card = this.getOrganizationCard(slug);
    const badge = card.locator('[class*="rounded-full"]').first();
    return badge.textContent();
  }

  // ===== Assertions =====

  async expectLoaded() {
    await expect(this.pageTitle).toBeVisible();
    await expect(this.newOrganizationButton).toBeVisible();
  }

  async expectOrganizationVisible(slug: string) {
    await expect(this.getOrganizationCard(slug)).toBeVisible();
  }

  async expectOrganizationStatus(slug: string, status: string) {
    const card = this.getOrganizationCard(slug);
    await expect(card.locator(`text=${status}`)).toBeVisible();
  }
}
