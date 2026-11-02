import { checkMath, insideMath } from '../src/shared/math-check.js';
import { mathExpressions } from '../src/shared/math-library.js';
import katex from 'katex';
test('finds math typos and unclosed delimiters while preserving custom commands and code', () => {
  expect(checkMath('$\\frca{a}{b}$')[0].replacement).toBe('\\frac');
  expect(checkMath('$$\\frac{a}{b}')).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('missing its closing') })]));
  expect(checkMath('$x_{i$')).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('Opening brace') })]));
  expect(checkMath('```{r}\nx <- "$\\frca"\n```')).toEqual([]);
  expect(checkMath('\\newcommand{\\frca}{x}\n$\\frca$')).toEqual([]);
  expect(insideMath('text $x+', 8)).toBe(true);
});
test('library snippets expose editable fields and contain no escaped placeholder markers', () => {
  expect(mathExpressions.length).toBeGreaterThan(25);
  expect(mathExpressions.find(item => item.id === 'frac')?.template).toBe('\\frac{${1:a}}{${2:b}}');
  expect(mathExpressions.every(item => !item.template.includes('\\${'))).toBe(true);
  for (const expression of mathExpressions) expect(() => katex.renderToString(expression.latex, { throwOnError: true, trust: false })).not.toThrow();
});
