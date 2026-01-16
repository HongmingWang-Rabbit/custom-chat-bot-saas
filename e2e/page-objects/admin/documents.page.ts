import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { TIMEOUTS } from '../../fixtures/test-data';

/**
 * Documents Page Object (/admin/documents)
 */
export class DocumentsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ===== Locators =====

  get pageTitle() {
    return this.page.locator('h1', { hasText: 'Documents' });
  }

  get pageSubtitle() {
    return this.page.locator('text=Manage knowledge base documents');
  }

  // Tenant selector
  get tenantSearchInput() {
    return this.page.locator('input[placeholder="Search organizations..."]');
  }

  get tenantDropdown() {
    return this.page.locator('[class*="absolute"][class*="z-10"]');
  }

  // Upload button
  get uploadButton() {
    return this.page.getByRole('button', { name: '+ Upload Document' });
  }

  // Documents grid
  get documentCards() {
    return this.page.locator('[class*="rounded-xl"][class*="border-gray-200"]').filter({
      has: this.page.locator('[class*="font-medium"]'),
    });
  }

  get loadingSpinner() {
    return this.page.locator('text=Loading documents...');
  }

  get emptyState() {
    return this.page.locator('text=No documents yet');
  }

  get selectTenantPrompt() {
    return this.page.locator('text=Select an organization');
  }

  // Upload modal
  get uploadModal() {
    return this.page.locator('[class*="fixed"]').filter({
      has: this.page.locator('h2', { hasText: 'Upload Document' }),
    });
  }

  get fileInput() {
    return this.page.locator('input[type="file"]');
  }

  get titleInput() {
    return this.page.locator('input[placeholder*="title"]');
  }

  get docTypeSelect() {
    return this.page.locator('select');
  }

  get uploadSubmitButton() {
    return this.uploadModal.getByRole('button', { name: 'Upload', exact: true });
  }

  get uploadCancelButton() {
    return this.uploadModal.getByRole('button', { name: 'Cancel' });
  }

  // View/Edit modals
  get viewModal() {
    return this.page.locator('[class*="fixed"]').filter({
      has: this.page.locator('h2', { hasText: 'Document Details' }),
    });
  }

  get editModal() {
    return this.page.locator('[class*="fixed"]').filter({
      has: this.page.locator('h2', { hasText: 'Edit Document' }),
    });
  }

  // ===== Actions =====

  async navigate() {
    await this.goto('/admin/documents');
    await this.waitForNetworkIdle();
  }

  async selectTenant(tenantName: string) {
    await this.tenantSearchInput.fill(tenantName);
    // Wait for dropdown to appear
    await this.tenantDropdown.waitFor({ state: 'visible' });
    // Click the tenant option
    await this.page.locator(`button:has-text("${tenantName}")`).click();
    await this.waitForNetworkIdle();
  }

  async waitForDocumentsLoaded() {
    await this.loadingSpinner.waitFor({ state: 'hidden', timeout: TIMEOUTS.network });
  }

  async openUploadModal() {
    await this.uploadButton.click();
    await expect(this.uploadModal).toBeVisible();
  }

  async closeUploadModal() {
    await this.uploadCancelButton.click();
    await expect(this.uploadModal).not.toBeVisible();
  }

  /**
   * Upload a document.
   */
  async uploadDocument(filePath: string, title?: string, docType?: string) {
    await this.openUploadModal();

    // Set file
    await this.fileInput.setInputFiles(filePath);

    // Set optional fields
    if (title) {
      await this.titleInput.fill(title);
    }
    if (docType) {
      await this.docTypeSelect.selectOption(docType);
    }

    await this.uploadSubmitButton.click();
  }

  /**
   * Get document card by title.
   */
  getDocumentCard(title: string) {
    return this.page.locator('[class*="rounded-xl"]', { hasText: title });
  }

  /**
   * Click view on a document.
   */
  async viewDocument(title: string) {
    const card = this.getDocumentCard(title);
    await card.locator('button', { hasText: 'View' }).click();
    await expect(this.viewModal).toBeVisible();
  }

  /**
   * Click edit on a document.
   */
  async editDocument(title: string) {
    const card = this.getDocumentCard(title);
    await card.locator('button', { hasText: 'Edit' }).click();
    await expect(this.editModal).toBeVisible();
  }

  /**
   * Click delete on a document.
   */
  async deleteDocument(title: string) {
    const card = this.getDocumentCard(title);
    await card.locator('button', { hasText: 'Delete' }).click();
    // Confirm delete in modal
    await this.page.getByRole('button', { name: 'Delete' }).last().click();
  }

  // ===== Assertions =====

  async expectLoaded() {
    await expect(this.pageTitle).toBeVisible();
    await expect(this.uploadButton).toBeVisible();
  }

  async expectDocumentsVisible(count?: number) {
    await this.waitForDocumentsLoaded();
    if (count !== undefined) {
      await expect(this.documentCards).toHaveCount(count);
    } else {
      await expect(this.documentCards.first()).toBeVisible();
    }
  }

  async expectDocumentVisible(title: string) {
    await expect(this.getDocumentCard(title)).toBeVisible();
  }

  async expectEmptyState() {
    await expect(this.emptyState).toBeVisible();
  }
}
