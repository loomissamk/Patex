import { compileLatex } from '../src/compiler/compile.js';
import { renderLiterate } from '../src/compiler/render.js';
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
  test('rejects oversized literate source and bibliography before invoking Quarto', async () => {
    expect((await renderLiterate('x'.repeat(210_000), 'rmd')).ok).toBe(false);
    expect((await renderLiterate('# Test', 'qmd', [], 'x'.repeat(110_000))).ok).toBe(false);
  });
});
