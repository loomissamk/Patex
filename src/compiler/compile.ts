import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CompileResult } from '../shared/types.js';
const execFileAsync = promisify(execFile);
const MAX_SOURCE = 200_000;
export async function compileLatex(latex: string): Promise<CompileResult> {
  if (typeof latex !== 'string' || Buffer.byteLength(latex, 'utf8') > MAX_SOURCE) return { ok: false, log: 'LaTeX source is too large (200 KB max).' };
  const workdir = await mkdtemp(path.join(tmpdir(), 'patex-'));
  try {
    await writeFile(path.join(workdir, 'main.tex'), latex, { mode: 0o600 });
    let logs = '';
    for (let pass = 0; pass < 2; pass++) {
      try {
        const { stdout, stderr } = await execFileAsync('pdflatex', [
          '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-output-directory', workdir, 'main.tex',
        ], { cwd: workdir, timeout: 30000, maxBuffer: 1024 * 1024, env: {
          PATH: '/usr/bin:/bin', HOME: workdir, TEXMFOUTPUT: workdir, openin_any: 'p', openout_any: 'p',
        } });
        logs += (stdout + stderr).slice(-10000);
      } catch (e) {
        const err = e as Error & { stdout?: string; stderr?: string };
        return { ok: false, log: ((err.stdout || '') + (err.stderr || '') + err.message).slice(-14000) };
      }
    }
    const pdf = await readFile(path.join(workdir, 'main.pdf'));
    if (pdf.length > 5_000_000) return { ok: false, log: 'Resulting PDF exceeds 5 MB limit.' };
    return { ok: true, log: logs.slice(-4000), pdfBase64: pdf.toString('base64') };
  } finally { await rm(workdir, { recursive: true, force: true }); }
}
