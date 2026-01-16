import { test, expect, TEST_TENANT, SAMPLE_QUESTIONS } from '../fixtures';

/**
 * Q&A Interaction Flow
 *
 * Tests multi-turn conversations and citation behavior.
 */
test.describe('Q&A Interaction Flow', () => {
  test('should have multi-turn conversation', async ({ qaChatPage }) => {
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();

    // First question about earnings
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.earnings);
    const response1 = await qaChatPage.getLastResponse();
    expect(response1).toBeTruthy();
    expect(response1?.toLowerCase()).toContain('revenue');

    // Follow-up about risks
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.risks);
    const response2 = await qaChatPage.getLastResponse();
    expect(response2).toBeTruthy();
    expect(response2?.toLowerCase()).toContain('risk');

    // Third question about company info
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.faq);
    const response3 = await qaChatPage.getLastResponse();
    expect(response3).toBeTruthy();
  });

  test('should show citations for document-based answers', async ({
    qaChatPage,
  }) => {
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();

    // Ask specific question that should have citations
    await qaChatPage.askQuestion('What was the gross margin in Q3 2024?');

    await qaChatPage.expectHasCitations();

    // Get citations
    const citations = await qaChatPage.getCitations();
    expect(citations.length).toBeGreaterThan(0);

    // Citations should reference earnings document
    const hasEarningsCitation = citations.some(
      (c) => c?.includes('Earnings') || c?.includes('Q3')
    );
    expect(hasEarningsCitation).toBe(true);
  });

  test('should handle greeting appropriately', async ({ qaChatPage }) => {
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();

    // Send greeting
    await qaChatPage.askQuestion('Hello!');

    const response = await qaChatPage.getLastResponse();
    expect(response).toBeTruthy();

    // Greeting should get a friendly response
    // (not a "no information" type response)
  });

  test('should handle out-of-scope questions gracefully', async ({
    qaChatPage,
  }) => {
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();

    // Ask something completely unrelated
    await qaChatPage.askQuestion('What is the capital of France?');

    const response = await qaChatPage.getLastResponse();
    expect(response).toBeTruthy();

    // Should either:
    // 1. Indicate it doesn't have that info, or
    // 2. Provide general response without hallucinating
  });

  test('should recover from irrelevant to relevant question', async ({
    qaChatPage,
  }) => {
    await qaChatPage.navigate(TEST_TENANT.slug);
    await qaChatPage.expectLoaded();

    // First ask irrelevant question
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.irrelevant);
    await qaChatPage.getLastResponse();

    // Then ask relevant question
    await qaChatPage.askQuestion(SAMPLE_QUESTIONS.earnings);
    const response = await qaChatPage.getLastResponse();

    // Should get good answer with citations
    expect(response).toBeTruthy();
    expect(response?.toLowerCase()).toContain('revenue');
    await qaChatPage.expectHasCitations();
  });
});
