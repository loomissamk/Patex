import { createHash } from 'node:crypto';
import { compilerRequest } from './compiler-client.js';
import { ProjectStore } from './store.js';
import type { CompileResult } from '../shared/types.js';
import { projectLimits } from '../shared/project-files.js';

const running = new Map<string, { hash: string; controller: AbortController; promise: Promise<CompileResult> }>();
export function cancelBuild(store: ProjectStore, id: string): void { running.get(`${store.dataRoot}/${id}`)?.controller.abort(); }
export async function buildProject(store: ProjectStore, id: string, url: string, force = false): Promise<CompileResult> {
  const { project, files: inputFiles } = await store.buildInput(id);
  const files = inputFiles.sort((a, b) => a.name.localeCompare(b.name));
  const runtime = await compilerRequest<{ image: string }>(url, 'status', {});
  const hash = createHash('sha256').update(JSON.stringify({ files, format: project.format, mainFile: project.mainFile, engine: project.engine, runtime: runtime.image, renderer: 3 })).digest('hex');
  const key = `${store.dataRoot}/${id}`;
  const existing = running.get(key);
  if (existing?.hash === hash && !force) return existing.promise;
  if (existing) existing.controller.abort();
  const previous = await store.readBuild(id);
  if (!force && previous?.hash === hash && project.hasPdf) return { ok: true, log: previous.log, diagnostics: previous.diagnostics, cached: true };
  const controller = new AbortController();
  const promise = (async () => {
    await store.checkpoint(id);
    const useCache = project.format === 'rmd' && !/```\s*\{(?:python|node|js)|fig\.path|cache\.path/i.test(project.latex);
    const analysisCode = [project.latex.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0] || '', ...Array.from(project.latex.matchAll(/```\s*\{[^}]+\}[\s\S]*?\n```|`r\s[^`]+`/g), match => match[0])].join('\n');
    const cacheKey = createHash('sha256').update(JSON.stringify({ code: analysisCode, files: files.filter(file => file.name !== project.mainFile), runtime: runtime.image })).digest('hex');
    const cache = !force && useCache ? await store.readAnalysisCache(id) : null;
    const result = await compilerRequest<CompileResult>(url, 'compile', { latex: project.latex, format: project.format, mainFile: project.mainFile, engine: project.engine, files, bibliography: project.bibliography, useCache, analysisCache: cache?.key === cacheKey ? cache.files : [] }, controller.signal);
    if (controller.signal.aborted) throw new Error('Build superseded');
    const { project: latest, files: newestFiles } = await store.buildInput(id);
    const latestFiles = newestFiles.sort((a, b) => a.name.localeCompare(b.name));
    if (JSON.stringify(latestFiles) !== JSON.stringify(files) || latest.engine !== project.engine) throw new Error('Source changed during compilation; build again');
    if (result.ok && result.pdfBase64) {
      const pdf = Buffer.from(result.pdfBase64, 'base64');
      if (pdf.length > projectLimits.pdfBytes || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid compiled PDF');
      await store.savePdf(id, pdf);
      await store.writeBuild(id, { hash, log: result.log, diagnostics: result.diagnostics, synctexBase64: result.synctexBase64, sourceRoot: result.sourceRoot, runtime: { image: runtime.image } });
      if (result.analysisCache) await store.writeAnalysisCache(id, cacheKey, result.analysisCache);
    }
    return { ...result, pdfBase64: undefined, synctexBase64: undefined, sourceRoot: undefined, analysisCache: undefined };
  })().finally(() => { if (running.get(key)?.controller === controller) running.delete(key); });
  running.set(key, { hash, controller, promise });
  return promise;
}
