import { compileLatex } from '../src/compiler/compile.js';
describe('compiler boundaries', () => {
  test('rejects oversized sources without starting the compiler', async () => {
    const result = await compileLatex('a'.repeat(210_000));
    expect(result.ok).toBe(false);
    expect(result.log).toMatch(/too large/);
  });
  test('rejects asset path traversal before invoking LaTeX', async () => {
    const result = await compileLatex('\\documentclass{article}', [{ name: '../escape.tex', base64: Buffer.from('bad').toString('base64') }]);
    expect(result.ok).toBe(false);
    expect(result.log).toMatch(/Invalid asset/);
  });
});
