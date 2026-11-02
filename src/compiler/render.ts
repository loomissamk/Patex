import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { artifactName } from '../shared/artifacts.js';
import type { Artifact, CompileResult, DocumentFormat } from '../shared/types.js';

const execFileAsync = promisify(execFile);

// Quarto's default Markdown reader does not treat legacy R Markdown \(...\)
// and \[...\] as math. Change only the temporary render copy, never the
// project source, and leave fenced code and TeX row spacing (\\[6pt]) alone.
export function normalizeRmdMath(source: string): string {
  let fence: { marker: string; length: number } | undefined;
  return source.replace(/\r\n/g, '\n').split('\n').map(line => {
    const boundary = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (boundary && boundary[1][0] === fence.marker && boundary[1].length >= fence.length) fence = undefined;
      return line;
    }
    if (boundary) { fence = { marker: boundary[1][0], length: boundary[1].length }; return line; }
    if (/^\s*\\\[\s*$/.test(line)) return line.replace('\\[', () => '$$');
    if (/^\s*\\\]\s*$/.test(line)) return line.replace('\\]', () => '$$');
    let output = '';
    let ticks = 0;
    for (let i = 0; i < line.length;) {
      if (line[i] === '`') {
        let end = i + 1;
        while (line[end] === '`') end++;
        const count = end - i;
        ticks = ticks === 0 ? count : ticks === count ? 0 : ticks;
        output += line.slice(i, end);
        i = end;
      } else if (ticks === 0 && line.startsWith('\\(', i)) {
        const end = line.indexOf('\\)', i + 2);
        if (end > i && !line.slice(i + 2, end).includes('`')) {
          output += `$${line.slice(i + 2, end)}$`;
          i = end + 2;
        } else { output += line[i]; i++; }
      } else { output += line[i]; i++; }
    }
    return output;
  }).join('\n');
}

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

export async function renderLiterate(source: string, format: Extract<DocumentFormat, 'rmd' | 'qmd'>, assets: Artifact[] = [], bibliography = ''): Promise<CompileResult> {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 200_000) return { ok: false, log: 'Document source exceeds 200 KB.' };
  if (typeof bibliography !== 'string' || Buffer.byteLength(bibliography, 'utf8') > 100_000) return { ok: false, log: 'Bibliography exceeds 100 KB.' };
  if (!Array.isArray(assets) || assets.length > 12) return { ok: false, log: 'Too many assets.' };
  const workdir = await mkdtemp(path.join(tmpdir(), 'patex-document-'));
  try {
    const filename = format === 'rmd' ? 'main.Rmd' : 'main.qmd';
    const renderSource = format === 'rmd' ? normalizeRmdMath(source) : source;
    await writeFile(path.join(workdir, filename), attachBibliography(renderSource, bibliography), { mode: 0o600 });
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
      const { stdout, stderr } = await execFileAsync('quarto', args, {
        cwd: workdir, timeout: 120_000, maxBuffer: 1024 * 1024,
        env: {
          PATH: '/opt/quarto/bin:/usr/local/bin:/usr/bin:/bin', HOME: workdir, TMPDIR: workdir,
          LANG: 'C.UTF-8', R_LIBS_USER: workdir, RETICULATE_PYTHON: '/usr/bin/python3', QUARTO_DISABLE_VERSION_CHECK: '1',
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
