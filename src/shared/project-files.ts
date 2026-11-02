import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { DocumentFormat, ProjectFile } from './types.js';

export const projectLimits = { files: 500, fileBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, sourceBytes: 1_000_000, pdfBytes: 24 * 1024 * 1024 };
export function projectPath(name: string): string {
  // eslint-disable-next-line no-control-regex -- archive paths must reject control bytes
  if (typeof name !== 'string' || !name || name.length > 240 || /[\\\x00-\x1f\x7f<>:"|?*]/.test(name) || name.startsWith('/') || name.endsWith('/')) throw new Error('Invalid project file path');
  const parts = name.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || parts.some(p => /^(?:\.patex-|patex-output\.)/i.test(p))) throw new Error('Invalid project file path');
  return name;
}
export function mainFileFor(format: DocumentFormat): string { return format === 'tex' ? 'main.tex' : format === 'rmd' ? 'main.Rmd' : 'main.qmd'; }
export function formatForFile(name: string): DocumentFormat {
  if (/\.(?:tex|latex)$/i.test(name)) return 'tex';
  if (/\.rmd$/i.test(name)) return 'rmd';
  if (/\.qmd$/i.test(name)) return 'qmd';
  throw new Error('Choose a .tex, .latex, .Rmd, or .qmd main document');
}
export function decodedFiles(files: ProjectFile[]): { name: string; data: Buffer }[] {
  if (!Array.isArray(files) || files.length > projectLimits.files) throw new Error('Project file count exceeds 500');
  let total = 0;
  const names = new Set<string>();
  return files.map(file => {
    const name = projectPath(file?.name);
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error('Duplicate project file path');
    names.add(key);
    if (typeof file.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) throw new Error('Invalid project file encoding');
    const data = Buffer.from(file.base64, 'base64');
    total += data.length;
    if (data.toString('base64') !== file.base64 || data.length > projectLimits.fileBytes || total > projectLimits.totalBytes) throw new Error('Project file size limit exceeded');
    return { name, data };
  });
}
export async function materializeFiles(root: string, files: ProjectFile[]): Promise<void> {
  for (const { name, data } of decodedFiles(files)) {
    const filename = path.join(root, ...name.split('/'));
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(filename, data, { mode: 0o600 });
  }
}
