import {
  test,
  expect,
  TEST_TENANT,
  SAMPLE_QUESTIONS,
  EXPECTED_ANSWERS,
} from '../../fixtures';

test.describe('Q&A Chat Page', () => {
  test.beforeEach(async ({ qaChatPage }) => {
    await qaChatPage.navigate(TEST_TENANT.slug);
  });

  test('should display tenant name and chat interface', async ({
    qaChatPage,
  }) => {
    await qaChatPage.expectLoaded(TEST_TENANT.name);

    // Take screenshot
    await qaChatPage.takeScreenshot('qa-chat-empty');
  });

  test('should have navigation links', async ({ qaChatPage }) => {
    await expect(qaChatPage.homeLink).toBeVisible();
    await expect(qaChatPage.adminLink).toBeVisible();
  });

  test('should navigate to home', async ({ qaChatPage, page }) => {
    await qaChatPage.clickHome();
    // Should navigate to the landing page (root path)
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('should navigate to admin', async ({ qaChatPage, page }) => {
    await qaChatPage.clickAdmin();
    expect(page.url()).toContain('/admin');
  });

  test('should send a message and receive response', async ({ qaChatPage }) => {
    // Ask about earnings (should have data from seeded documents)
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.earnings);

    // Should have at least user message + assistant response
    const response = await qaChatPage.getLastResponse();
    expect(response).toBeTruthy();

    // Response should contain revenue information
    const containsExpected = EXPECTED_ANSWERS.earnings.some((keyword) =>
      response?.toLowerCase().includes(keyword.toLowerCase())
    );
    expect(containsExpected).toBe(true);

    // Take screenshot with response
    await qaChatPage.takeScreenshot('qa-chat-with-response');
  });

  test('should display citations for document-based answers', async ({
    qaChatPage,
  }) => {
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.earnings);

    // Should have citations
    await qaChatPage.expectHasCitations();
  });

  test('should handle FAQ questions', async ({ qaChatPage }) => {
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.faq);

    const response = await qaChatPage.getLastResponse();
    expect(response).toBeTruthy();

    // Should mention founding year or founders
    const containsExpected = EXPECTED_ANSWERS.faq.some((keyword) =>
      response?.includes(keyword)
    );
    expect(containsExpected).toBe(true);
  });

  test('should handle greeting messages', async ({ qaChatPage }) => {
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.greeting);

    const response = await qaChatPage.getLastResponse();
    expect(response).toBeTruthy();

    // Greeting response should not have document citations
    // (or have generic response)
  });

  test('should handle irrelevant questions gracefully', async ({
    qaChatPage,
  }) => {
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.irrelevant);

    const response = await qaChatPage.getLastResponse();
    expect(response).toBeTruthy();

    // Should indicate lack of relevant information or provide general response
  });

  test('should support multiple questions in sequence', async ({
    qaChatPage,
  }) => {
    // First question
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.earnings);
    const response1 = await qaChatPage.getLastResponse();
    expect(response1).toBeTruthy();

    // Second question
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.governance);
    const response2 = await qaChatPage.getLastResponse();
    expect(response2).toBeTruthy();

    // Both responses should be in the chat
    const containsGovernance = EXPECTED_ANSWERS.governance.some((keyword) =>
      response2?.toLowerCase().includes(keyword.toLowerCase())
    );
    expect(containsGovernance).toBe(true);
  });
});
