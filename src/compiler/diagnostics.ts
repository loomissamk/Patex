import type { Diagnostic } from '../shared/types.js';
export function parseDiagnostics(log: string, mainFile: string): Diagnostic[] {
  // eslint-disable-next-line no-control-regex -- remove terminal color escapes from compiler logs
  const clean = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const items: Diagnostic[] = [];
  for (const line of clean.split(/\r?\n/)) {
    const tex = line.match(/(?:^|\s)([^\s:]+\.(?:tex|latex|sty|cls)):(\d+):\s*(.+)/);
    if (tex) items.push({ severity: 'error', file: tex[1].replace(/^.*\/patex-[^/]+\//, '').replace(/^\.\//, ''), line: Number(tex[2]), message: tex[3] });
    else if (/Quitting from lines? /i.test(line)) {
      const rmd = line.match(/lines?\s+(\d+)(?:-\d+)?\s*(?:\(([^)]+)\))?/i);
      if (rmd) items.push({ severity: 'error', file: rmd[2] || mainFile, line: Number(rmd[1]), message: line.trim() });
    } else if (/undefined|not found|Missing \$|Error in |LaTeX Error|^! /i.test(line)) items.push({ severity: /undefined|warning/i.test(line) ? 'warning' : 'error', file: mainFile, message: line.trim().slice(0, 500) });
  }
  return items.filter((item, i) => items.findIndex(other => JSON.stringify(other) === JSON.stringify(item)) === i).slice(0, 100);
}
