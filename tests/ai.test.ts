import { extractLatex } from '../src/server/ai.js';
describe('AI suggestions', () => {
  test('extracts code without silently writing', () => {
    expect(extractLatex('Try this:\n```latex\n\\begin{document}\nHi\n```')).toBe('\\begin{document}\nHi');
  });
  test('does not accept unstructured text as source', () => {
    expect(extractLatex('This formula needs an amsmath package.')).toBeNull();
  });
});
