import { execFile } from 'node:child_process';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Artifact, CompileResult } from '../shared/types.js';
import { artifactName } from '../shared/artifacts.js';
import { materializeFiles, projectLimits, projectPath } from '../shared/project-files.js';
import { parseDiagnostics } from './diagnostics.js';
import type { DocumentOptions } from './options.js';
import { workDirectory } from './workspace.js';
const execFileAsync = promisify(execFile);
export async function compileLatex(latex: string, assets: Artifact[] = [], bibliography = '', options: DocumentOptions = {}): Promise<CompileResult> {
  if (typeof latex !== 'string' || Buffer.byteLength(latex) > projectLimits.sourceBytes) return { ok: false, log: 'LaTeX source is too large (1 MB max).' };
  if (typeof bibliography !== 'string' || Buffer.byteLength(bibliography) > projectLimits.sourceBytes) return { ok: false, log: 'Bibliography is too large.' };
  if (!Array.isArray(assets) || assets.length > 12) return { ok: false, log: 'Too many assets.' };
  const mainFile = options.mainFile || 'main.tex';
  const workdir = await workDirectory('patex-');
  try {
    projectPath(mainFile);
    const files = [...(options.files || [])];
    for (const asset of assets) {
      if (!asset || !artifactName.test(asset.name)) return { ok: false, log: 'Invalid asset.' };
      if (!files.some(file => file.name === `assets/${asset.name}`)) files.push({ ...asset, name: `assets/${asset.name}` });
    }
    await materializeFiles(workdir, files);
    await mkdir(path.dirname(path.join(workdir, mainFile)), { recursive: true });
    await writeFile(path.join(workdir, mainFile), latex, { mode: 0o600 });
    if (bibliography) await writeFile(path.join(workdir, path.posix.dirname(mainFile), 'references.bib'), bibliography, { mode: 0o600 });
    const engine = options.engine || 'pdflatex';
    if (!['pdflatex', 'xelatex', 'lualatex'].includes(engine)) return { ok: false, log: 'Invalid PDF engine.' };
    const { stdout, stderr } = await execFileAsync('latexmk', [
      engine === 'xelatex' ? '-xelatex' : engine === 'lualatex' ? '-lualatex' : '-pdf',
      '-synctex=1', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-no-shell-escape',
      '-jobname=patex-output', `-outdir=${workdir}`, mainFile,
    ], { cwd: workdir, timeout: 120_000, maxBuffer: 2 * 1024 * 1024, env: {
      PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workdir, TEXMFOUTPUT: workdir, openin_any: 'p', openout_any: 'p', LANG: 'C.UTF-8',
    } });
    const log = (stdout + stderr).slice(-14000);
    const pdf = await readFile(path.join(workdir, 'patex-output.pdf'));
    if (pdf.length > projectLimits.pdfBytes || pdf.subarray(0, 5).toString() !== '%PDF-') return { ok: false, log: 'Invalid or oversized PDF (24 MB max).' };
    const synctex = await readFile(path.join(workdir, 'patex-output.synctex.gz')).catch(() => null);
    return { ok: true, log, pdfBase64: pdf.toString('base64'), diagnostics: parseDiagnostics(log, mainFile), ...(synctex ? { synctexBase64: synctex.toString('base64'), sourceRoot: workdir } : {}) };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const log = ((err.stdout || '') + (err.stderr || '') + err.message).slice(-14000);
    return { ok: false, log, diagnostics: parseDiagnostics(log, mainFile) };
  } finally { await rm(workdir, { recursive: true, force: true }); }
}
