import { compileLatex } from '../src/compiler/compile.js';
describe('compiler boundaries', () => {
  test('rejects oversized sources without starting the compiler', async () => {
    const result = await compileLatex('a'.repeat(210_000));
    expect(result.ok).toBe(false);
    expect(result.log).toMatch(/too large/);
  });
});
