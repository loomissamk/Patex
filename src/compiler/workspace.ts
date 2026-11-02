import { mkdir, mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ProjectFile } from '../shared/types.js';
export async function workDirectory(prefix: string): Promise<string> {
  if (process.env.PATEX_JOB === '1') { const dir = '/tmp/patex-project'; await mkdir(dir, { recursive: true, mode: 0o700 }); return dir; }
  return mkdtemp(path.join(tmpdir(), prefix));
}
export async function collectAnalysisCache(root: string): Promise<ProjectFile[]> {
  const files: ProjectFile[] = []; let total = 0;
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), prefix + entry.name + '/');
      else if (entry.isFile()) {
        const filename = path.join(dir, entry.name); total += (await stat(filename)).size;
        if (total > 8 * 1024 * 1024 || files.length >= 150) throw new Error('Analysis cache limit');
        files.push({ name: prefix + entry.name, base64: (await readFile(filename)).toString('base64') });
      }
    }
  };
  try { await walk(root, ''); return files; } catch { return []; }
}
