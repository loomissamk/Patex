import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { artifactName } from '../shared/artifacts.js';
import type { Artifact, CompileResult, DocumentFormat } from '../shared/types.js';
import { materializeFiles, projectLimits, projectPath } from '../shared/project-files.js';
import { parseDiagnostics } from './diagnostics.js';
import type { DocumentOptions } from './options.js';
import { collectAnalysisCache, workDirectory } from './workspace.js';

const execFileAsync = promisify(execFile);

export function attachBibliography(source: string, bibliography: string): string {
  if (!bibliography) return source;
  const normalized = source.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return `---\nbibliography: references.bib\n---\n\n${normalized}`;
  const frontMatterEnd = normalized.indexOf('\n---\n', 4);
  if (frontMatterEnd < 0) return normalized;
  const frontMatter = normalized.slice(4, frontMatterEnd);
  if (/^bibliography\s*:/m.test(frontMatter)) return normalized;
  return normalized.replace(/^---\n/, '---\nbibliography: references.bib\n');
}

export async function renderLiterate(source: string, format: Extract<DocumentFormat, 'rmd' | 'qmd'>, assets: Artifact[] = [], bibliography = '', options: DocumentOptions = {}): Promise<CompileResult> {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > projectLimits.sourceBytes) return { ok: false, log: 'Document source exceeds 1 MB.' };
  if (typeof bibliography !== 'string' || Buffer.byteLength(bibliography, 'utf8') > 100_000) return { ok: false, log: 'Bibliography exceeds 100 KB.' };
  if (!Array.isArray(assets) || assets.length > 12) return { ok: false, log: 'Too many assets.' };
  const workdir = await workDirectory('patex-document-');
  try {
    const filename = projectPath(options.mainFile || (format === 'rmd' ? 'main.Rmd' : 'main.qmd'));
    await materializeFiles(workdir, options.files || []);
    if (options.useCache) await materializeFiles(path.join(workdir, '.patex-cache'), options.analysisCache || []);
    await mkdir(path.dirname(path.join(workdir, filename)), { recursive: true });
    await writeFile(path.join(workdir, filename), attachBibliography(source, bibliography), { mode: 0o600 });
    if (bibliography) await writeFile(path.join(workdir, path.posix.dirname(filename), 'references.bib'), bibliography, { mode: 0o600 });
    if (format === 'rmd') await writeFile(path.join(workdir, '.here'), '', { flag: 'wx', mode: 0o600 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
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
      const quartoArgs = [
        'render', filename, '--to', 'pdf', '--output', 'patex-output.pdf', '--output-dir', workdir, '--no-cache',
        '-M', 'pdf-engine:pdflatex', '-M', 'latex-auto-install:false',
      ];
      const command = format === 'rmd' ? 'Rscript' : 'quarto';
      const args = format === 'rmd'
        ? ['--vanilla', '-e', `${options.useCache ? 'knitr::opts_chunk$set(cache=TRUE);knitr::opts_hooks$set(cache=function(options){options$cache.path=paste0(Sys.getenv("HOME"),"/.patex-cache/");options$fig.path=paste0(Sys.getenv("HOME"),"/.patex-cache/figures/");options});' : ''}rmarkdown::render(${JSON.stringify(filename)}, output_format="pdf_document", output_file="patex-output.pdf", output_dir=getwd(), quiet=TRUE)`]
        : quartoArgs;
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: workdir, timeout: 120_000, maxBuffer: 1024 * 1024,
        env: {
          PATH: '/opt/quarto/bin:/usr/local/bin:/usr/bin:/bin', HOME: workdir, TMPDIR: workdir,
          LANG: 'C.UTF-8', R_LIBS_USER: workdir, RETICULATE_PYTHON: '/usr/bin/python3',
          RSTUDIO_PANDOC: '/opt/quarto/bin/tools', QUARTO_DISABLE_VERSION_CHECK: '1',
        },
      });
      const pdf = await readFile(path.join(workdir, 'patex-output.pdf'));
      if (pdf.length > projectLimits.pdfBytes || pdf.subarray(0, 5).toString() !== '%PDF-') return { ok: false, log: 'Invalid or oversized PDF.' };
      const log = (stdout + stderr).slice(-14000);
      return { ok: true, log, pdfBase64: pdf.toString('base64'), diagnostics: parseDiagnostics(log, filename), ...(options.useCache ? { analysisCache: await collectAnalysisCache(path.join(workdir, '.patex-cache')) } : {}) };
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string };
      return { ok: false, log: ((err.stdout || '') + (err.stderr || '') + err.message).slice(-14000) };
    }
  } finally { await rm(workdir, { recursive: true, force: true }); }
}
