import { completeAI, extractLatex } from '../src/server/ai.js';
describe('AI suggestions', () => {
  test('extracts code without silently writing', () => {
    expect(extractLatex('Try this:\n```latex\n\\begin{document}\nHi\n```')).toBe('\\begin{document}\nHi');
  });
  test('does not accept unstructured text as source', () => {
    expect(extractLatex('This formula needs an amsmath package.')).toBeNull();
  });
  test('returns only provider completion text for insertion at the cursor', async () => {
    const previousUrl = process.env.LLAMAFARM_CHAT_URL;
    const previousModel = process.env.LLAMAFARM_MODEL;
    const originalFetch = global.fetch;
    process.env.LLAMAFARM_CHAT_URL = 'http://localhost:42617/v1/chat/completions';
    process.env.LLAMAFARM_MODEL = 'test-model';
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '```latex\n\\frac{1}{2}\n```' } }] }), { status: 200 }));
    try {
      expect(await completeAI('llamafarm', 'We have ', ' today.')).toBe('\\frac{1}{2}');
      const request = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string) as { max_tokens: number; messages: Array<{ content: string }> };
      expect(request.max_tokens).toBe(100);
      expect(request.messages[1].content).toContain('We have ');
    } finally {
      global.fetch = originalFetch;
      if (previousUrl === undefined) delete process.env.LLAMAFARM_CHAT_URL; else process.env.LLAMAFARM_CHAT_URL = previousUrl;
      if (previousModel === undefined) delete process.env.LLAMAFARM_MODEL; else process.env.LLAMAFARM_MODEL = previousModel;
    }
  });
});
