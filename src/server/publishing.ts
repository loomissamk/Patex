import type { Diagnostic, ProjectFile } from '../shared/types.js';
export function publishingIndex(files: ProjectFile[], mainFile: string): { citations: string[]; labels: string[]; diagnostics: Diagnostic[] } {
  const citations = new Set<string>(); const labels = new Set<string>();
  for (const file of files) {
    if (!/\.(bib|tex|latex|rmd|qmd)$/i.test(file.name)) continue;
    const text = Buffer.from(file.base64, 'base64').toString('utf8');
    if (/\.bib$/i.test(file.name)) for (const match of text.matchAll(/@\w+\s*[{(]\s*([^\s,]+)\s*,/g)) citations.add(match[1]);
    else {
      for (const match of text.matchAll(/\\label\s*\{([^}]+)\}|\{#([A-Za-z][\w:.-]*)\}|^\s*#\|\s*label:\s*([\w:.-]+)/gm)) labels.add(match[1] || match[2] || match[3]);
      for (const match of text.matchAll(/^\s*-?\s*id:\s*["']?([\w:.-]+)/gm)) citations.add(match[1]);
    }
  }
  const diagnostics: Diagnostic[] = [];
  const source = Buffer.from(files.find(file => file.name === mainFile)?.base64 || '', 'base64').toString('utf8');
  const body = source.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1/g, match => match.replace(/[^\n]/g, ' '));
  const missing = (key: string, kind: string, at: number) => diagnostics.push({ severity: 'warning', file: mainFile, line: body.slice(0, at).split('\n').length, message: `${kind} “${key}” is not defined in this project` });
  for (const match of body.matchAll(/\\(?:cite\w*|autocite|parencite)(?:\[[^\]]*\])*\{([^}]+)\}/g)) for (const key of match[1].split(',').map(s => s.trim())) if (key !== '*' && !citations.has(key)) missing(key, 'Citation', match.index!);
  for (const match of body.matchAll(/\\(?:eqref|ref|autoref|cref|Cref)\{([^}]+)\}/g)) for (const key of match[1].split(',').map(s => s.trim())) if (!labels.has(key)) missing(key, 'Reference', match.index!);
  for (const match of body.matchAll(/(?:\[|;|\s)[-]?@([A-Za-z][\w:./-]*)/g)) if (!citations.has(match[1]) && !labels.has(match[1])) missing(match[1], 'Citation or cross-reference', match.index!);
  return { citations: [...citations].sort(), labels: [...labels].sort(), diagnostics: diagnostics.slice(0, 100) };
}
