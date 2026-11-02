export interface MathIssue { from: number; to: number; message: string; replacement?: string }
const corrections: Record<string, string> = { frca: 'frac', fraq: 'frac', squrt: 'sqrt', sqr: 'sqrt', alhpa: 'alpha', alpah: 'alpha', betta: 'beta', lamba: 'lambda', lamda: 'lambda', sigam: 'sigma', epslion: 'epsilon', rigth: 'right', lef: 'left', begn: 'begin', cdto: 'cdot', inifnty: 'infty', neqq: 'neq' };
function maskCode(source: string): string { return source.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1/g, part => part.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, part => ' '.repeat(part.length)); }
export function insideMath(source: string, cursor: number): boolean {
  const before = maskCode(source.slice(0, cursor));
  let dollar: string | undefined;
  for (const match of before.matchAll(/(?<!\\)(\$\$|\$)/g)) { if (!dollar) dollar = match[1]; else if (dollar === match[1]) dollar = undefined; }
  return Boolean(dollar) || before.lastIndexOf('\\[') > before.lastIndexOf('\\]') || before.lastIndexOf('\\(') > before.lastIndexOf('\\)') || /\\begin\{(?:equation\*?|align\*?|gather\*?)\}(?:(?!\\end\{)[\s\S])*$/.test(before);
}
export function checkMath(source: string): MathIssue[] {
  const text = maskCode(source).replace(/(?<!\\)%[^\n]*/g, part => ' '.repeat(part.length));
  const issues: MathIssue[] = [];
  const declared = new Set([...text.matchAll(/\\(?:newcommand|renewcommand|providecommand)\s*\{?\\([A-Za-z]+)|\\def\\([A-Za-z]+)/g)].map(match => match[1] || match[2]));
  for (const match of text.matchAll(/\\([A-Za-z]+)/g)) {
    const command = match[1];
    if (corrections[command] && !declared.has(command)) issues.push({ from: match.index!, to: match.index! + match[0].length, message: `Possible command typo: \\${command}. Use \\${corrections[command]}?`, replacement: `\\${corrections[command]}` });
  }
  const tokens = /(?<!\\)(\$\$|\$)|\\([()[\]])|\\(begin|end)\{(equation\*?|align\*?|gather\*?|displaymath)\}/g;
  let open: { marker: string; from: number; end: string } | undefined;
  const braces: number[] = [];
  let last = 0;
  const scan = (end: number) => {
    for (let i = last; i < end; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '{') braces.push(i);
      if (text[i] === '}') { if (braces.length) braces.pop(); else issues.push({ from: i, to: i + 1, message: 'Closing brace has no opening brace in this math expression' }); }
    }
  };
  for (const match of text.matchAll(tokens)) {
    const marker = match[1] || (match[2] ? `\\${match[2]}` : `\\${match[3]}{${match[4]}}`);
    const closes = marker === '\\)' || marker === '\\]' || match[3] === 'end';
    if (!open && !closes) { open = { marker, from: match.index!, end: match[1] || (match[2] === '(' ? '\\)' : match[2] === '[' ? '\\]' : `\\end{${match[4]}}`) }; last = match.index! + match[0].length; continue; }
    if (open && marker === open.end) {
      scan(match.index!);
      for (const position of braces.splice(0)) issues.push({ from: position, to: position + 1, message: 'Opening brace is not closed in this math expression' });
      open = undefined;
    } else if (!open && closes) issues.push({ from: match.index!, to: match.index! + match[0].length, message: 'Math closing delimiter has no matching opener' });
  }
  if (open) issues.push({ from: open.from, to: open.from + open.marker.length, message: `Math expression is missing its closing ${open.end}` });
  return issues.slice(0, 100);
}
