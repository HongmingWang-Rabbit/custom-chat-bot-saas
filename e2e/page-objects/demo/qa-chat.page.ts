import { Page, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { TIMEOUTS } from '../../fixtures/test-data';

/**
 * Q&A Chat Page Object (/demo/[tenantSlug])
 */
export class QAChatPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ===== Locators =====

  get header() {
    return this.page.locator('header');
  }

  get tenantName() {
    return this.header.locator('h1');
  }

  get homeLink() {
    return this.page.getByRole('link', { name: 'Home' });
  }

  get adminLink() {
    return this.page.getByRole('link', { name: 'Admin Panel' });
  }

  // Chat area
  get chatContainer() {
    return this.page.locator('[class*="rounded-2xl"][class*="border"]');
  }

  get messageInput() {
    return this.page.getByTestId('chat-input');
  }

  get sendButton() {
    return this.page.getByTestId('chat-submit');
  }

  get loadingIndicator() {
    return this.page.getByTestId('chat-loading');
  }

  // Messages - using data-testid
  get userMessages() {
    return this.page.getByTestId('chat-message-user');
  }

  get assistantMessages() {
    return this.page.getByTestId('chat-message-assistant');
  }

  get allMessages() {
    return this.page.locator('[data-testid^="chat-message-"]');
  }

  // Citations - using data-testid
  get citations() {
    return this.page.getByTestId('chat-citation');
  }

  // ===== Actions =====

  async navigate(tenantSlug: string) {
    await this.goto(`/demo/${tenantSlug}`);
    await this.waitForNetworkIdle();
  }

  /**
   * Type and send a message.
   */
  async sendMessage(message: string) {
    await this.messageInput.fill(message);
    await this.messageInput.press('Enter');
  }

  /**
   * Wait for the assistant to finish responding.
   * Uses proper wait conditions instead of arbitrary timeout.
   */
  async waitForResponse(timeout = TIMEOUTS.streaming) {
    // First wait for loading to appear (response started)
    try {
      await this.loadingIndicator.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      // Loading might be very brief or already done
    }

    // Then wait for loading to disappear (response complete)
    await this.loadingIndicator.waitFor({ state: 'hidden', timeout });

    // Also wait for network to settle
    await this.waitForNetworkIdle();
  }

  /**
   * Send a message and wait for response.
   */
  async askQuestion(question: string) {
    await this.sendMessage(question);
    await this.waitForResponse();
  }

  /**
   * Get the last assistant message text.
   */
  async getLastResponse() {
    const messages = await this.assistantMessages.all();
    if (messages.length === 0) {
      return null;
    }
    return messages[messages.length - 1].textContent();
  }

  /**
   * Get all citation texts.
   */
  async getCitations() {
    const citationElements = await this.citations.all();
    return Promise.all(citationElements.map((c) => c.textContent()));
  }

  /**
   * Click a citation to expand/view.
   */
  async clickCitation(index: number) {
    const citation = this.citations.nth(index);
    await citation.click();
  }

  // ===== Assertions =====

  async expectLoaded(tenantName?: string) {
    await expect(this.chatContainer).toBeVisible();
    if (tenantName) {
      await expect(this.tenantName).toContainText(tenantName);
    }
  }

  async expectEmptyState() {
    // No messages yet means empty state
    await expect(this.userMessages).toHaveCount(0);
  }

  async expectMessageCount(count: number) {
    await expect(this.allMessages).toHaveCount(count);
  }

  async expectResponseContains(text: string) {
    const response = await this.getLastResponse();
    expect(response).toContain(text);
  }

  async expectHasCitations() {
    await expect(this.citations.first()).toBeVisible();
  }

  async expectNoCitations() {
    await expect(this.citations).toHaveCount(0);
  }
}
