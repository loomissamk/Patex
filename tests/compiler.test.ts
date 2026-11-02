import { compileLatex } from '../src/compiler/compile.js';
import { attachBibliography, normalizeRmdMath, renderLiterate } from '../src/compiler/render.js';
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
  test('makes managed bibliography visible to the document engine', () => {
    const source = '---\ntitle: Paper\n---\n\nCite [@knuth1984].';
    expect(attachBibliography(source, '@book{knuth1984}')).toContain('---\nbibliography: references.bib\ntitle:');
    expect(attachBibliography(source, '')).toBe(source);
  });
  test('normalizes legacy Rmd math without changing code or TeX row spacing', () => {
    const source = '\\[\nx^2\n\\]\nUse \\(x+1\\) and `\\(literal\\)`.\n```{r}\ncat("\\(literal\\)")\n```\n\\\\[6pt]';
    expect(normalizeRmdMath(source)).toBe('$$\nx^2\n$$\nUse $x+1$ and `\\(literal\\)`.\n```{r}\ncat("\\(literal\\)")\n```\n\\\\[6pt]');
  });
});
