import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { projectPath } from '../shared/project-files.js';
const execute = promisify(execFile);
export interface SyncInput { mode: 'forward' | 'inverse'; pdfBase64: string; synctexBase64: string; sourceRoot: string; file?: string; line?: number; page?: number; x?: number; y?: number }
export async function sourceMap(input: SyncInput): Promise<{ page?: number; x?: number; y?: number; file?: string; line?: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'patex-sync-'));
  try {
    await writeFile(path.join(dir, 'patex-output.pdf'), Buffer.from(input.pdfBase64, 'base64'));
    await writeFile(path.join(dir, 'patex-output.synctex.gz'), Buffer.from(input.synctexBase64, 'base64'));
    const pdf = path.join(dir, 'patex-output.pdf');
    const args = input.mode === 'forward'
      ? ['view', '-i', `${Number(input.line) || 1}:0:${input.sourceRoot}/${projectPath(input.file || 'main.tex')}`, '-o', pdf]
      : ['edit', '-o', `${Number(input.page) || 1}:${Number(input.x) || 0}:${Number(input.y) || 0}:${pdf}`];
    const { stdout } = await execute('synctex', args, { timeout: 10_000, maxBuffer: 200_000 });
    const number = (key: string) => { const value = stdout.match(new RegExp(`^${key}:([\\d.-]+)`, 'm')); return value ? Number(value[1]) : undefined; };
    if (input.mode === 'forward') return { page: number('Page'), x: number('x'), y: number('y') };
    const filename = stdout.match(/^Input:(.+)$/m)?.[1];
    return { ...(filename ? { file: projectPath(filename.replace(`${input.sourceRoot}/`, '')) } : {}), line: number('Line') };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
