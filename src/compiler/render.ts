import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { artifactName } from '../shared/artifacts.js';
import type { Artifact, CompileResult, DocumentFormat } from '../shared/types.js';

const execFileAsync = promisify(execFile);

export async function renderLiterate(source: string, format: Extract<DocumentFormat, 'rmd' | 'qmd'>, assets: Artifact[] = [], bibliography = ''): Promise<CompileResult> {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 200_000) return { ok: false, log: 'Document source exceeds 200 KB.' };
  if (typeof bibliography !== 'string' || Buffer.byteLength(bibliography, 'utf8') > 100_000) return { ok: false, log: 'Bibliography exceeds 100 KB.' };
  if (!Array.isArray(assets) || assets.length > 12) return { ok: false, log: 'Too many assets.' };
  const workdir = await mkdtemp(path.join(tmpdir(), 'patex-document-'));
  try {
    const filename = format === 'rmd' ? 'main.Rmd' : 'main.qmd';
    await writeFile(path.join(workdir, filename), source, { mode: 0o600 });
    if (bibliography) await writeFile(path.join(workdir, 'references.bib'), bibliography, { mode: 0o600 });
    await mkdir(path.join(workdir, 'assets'), { mode: 0o700 });
    let total = 0;
    for (const asset of assets) {
      if (!asset || typeof asset.name !== 'string' || !artifactName.test(asset.name) || typeof asset.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) return { ok: false, log: 'Invalid asset.' };
      const bytes = Buffer.from(asset.base64, 'base64');
      total += bytes.length;
      if (bytes.length > 512 * 1024 || total > 2 * 1024 * 1024 || bytes.toString('base64') !== asset.base64) return { ok: false, log: 'Invalid asset size or encoding.' };
      await writeFile(path.join(workdir, 'assets', asset.name), bytes, { mode: 0o600 });
    }
    try {
      const args = [
        'render', filename, '--to', 'pdf', '--output', 'main.pdf', '--no-cache',
        '-M', 'pdf-engine:pdflatex', '-M', 'latex-auto-install:false',
      ];
      if (bibliography) args.push('-M', 'bibliography:references.bib');
      const { stdout, stderr } = await execFileAsync('quarto', args, {
        cwd: workdir, timeout: 120_000, maxBuffer: 1024 * 1024,
        env: {
          PATH: '/opt/quarto/bin:/usr/local/bin:/usr/bin:/bin', HOME: workdir, TMPDIR: workdir,
          LANG: 'C.UTF-8', R_LIBS_USER: workdir, QUARTO_DISABLE_VERSION_CHECK: '1',
        },
      });
      const pdf = await readFile(path.join(workdir, 'main.pdf'));
      if (pdf.length > 5_000_000 || pdf.subarray(0, 5).toString() !== '%PDF-') return { ok: false, log: 'Invalid or oversized PDF.' };
      return { ok: true, log: (stdout + stderr).slice(-4000), pdfBase64: pdf.toString('base64') };
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string };
      return { ok: false, log: ((err.stdout || '') + (err.stderr || '') + err.message).slice(-14000) };
    }
  } finally { await rm(workdir, { recursive: true, force: true }); }
}
