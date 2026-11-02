import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Artifact, CompileResult } from '../shared/types.js';
import { artifactName } from '../shared/artifacts.js';
const execFileAsync = promisify(execFile);
const MAX_SOURCE = 200_000;
export async function compileLatex(latex: string, assets: Artifact[] = [], bibliography = ''): Promise<CompileResult> {
  if (typeof latex !== 'string' || Buffer.byteLength(latex, 'utf8') > MAX_SOURCE) return { ok: false, log: 'LaTeX source is too large (200 KB max).' };
  if (typeof bibliography !== 'string' || Buffer.byteLength(bibliography, 'utf8') > 100_000) return { ok: false, log: 'Bibliography is too large (100 KB max).' };
  if (!Array.isArray(assets) || assets.length > 12) return { ok: false, log: 'Too many assets.' };
  const workdir = await mkdtemp(path.join(tmpdir(), 'patex-'));
  try {
    await writeFile(path.join(workdir, 'main.tex'), latex, { mode: 0o600 });
    if (bibliography) await writeFile(path.join(workdir, 'references.bib'), bibliography, { mode: 0o600 });
    await mkdir(path.join(workdir, 'assets'), { mode: 0o700 });
    let total = 0;
    for (const asset of assets) {
      if (!asset || typeof asset.name !== 'string' || !artifactName.test(asset.name) || typeof asset.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) return { ok: false, log: 'Invalid asset.' };
      const data = Buffer.from(asset.base64, 'base64');
      total += data.length;
      if (data.length > 512 * 1024 || total > 2 * 1024 * 1024 || data.toString('base64') !== asset.base64) return { ok: false, log: 'Asset size or encoding is invalid.' };
      await writeFile(path.join(workdir, 'assets', asset.name), data, { mode: 0o600 });
    }
    let logs = '';
    const usesBibtex = Boolean(bibliography && /\\bibliography\s*\{[^}]*references[^}]*\}/.test(latex));
    for (let pass = 0; pass < (usesBibtex ? 3 : 2); pass++) {
      try {
        const { stdout, stderr } = await execFileAsync('pdflatex', [
          '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-output-directory', workdir, 'main.tex',
        ], { cwd: workdir, timeout: 30000, maxBuffer: 1024 * 1024, env: {
          PATH: '/usr/bin:/bin', HOME: workdir, TEXMFOUTPUT: workdir, openin_any: 'p', openout_any: 'p',
        } });
        logs += (stdout + stderr).slice(-10000);
        if (pass === 0 && usesBibtex) {
          const bibliographyResult = await execFileAsync('bibtex', ['main'], { cwd: workdir, timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin', HOME: workdir } });
          logs += (bibliographyResult.stdout + bibliographyResult.stderr).slice(-10000);
        }
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
