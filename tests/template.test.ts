import { defaultLatex } from '../src/shared/template.js';
describe('starter LaTeX project', () => {
  test('is a complete article with math', () => {
    expect(defaultLatex).toContain('\\documentclass');
    expect(defaultLatex).toContain('\\begin{document}');
    expect(defaultLatex).toContain('\\end{document}');
    expect(defaultLatex).toContain('\\frac{1}{3}');
  });
});
