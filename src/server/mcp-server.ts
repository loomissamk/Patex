import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ProjectStore } from './store.js';
import type { RunResult } from '../shared/types.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

export function createPatexMcpServer(store: ProjectStore, compilerUrl: string): McpServer {
  const server = new McpServer({ name: 'patex', version: '0.1.0' });
  server.tool('patex_list_projects', 'List Patex projects', {}, async () => result(await store.list()));
  server.tool('patex_get_project', 'Read LaTeX source from a Patex project', { id: z.string().uuid() }, async ({ id }) => result(await store.get(id)));
  server.tool('patex_create_project', 'Create a LaTeX project', { name: z.string().max(100) }, async ({ name }) => result(await store.create(name)));
  server.tool('patex_update_latex', 'Replace LaTeX source in a project', { id: z.string().uuid(), latex: z.string().max(200000) }, async ({ id, latex }) => result(await store.update(id, { latex })));
  const language = z.enum(['javascript', 'python', 'r']);
  server.tool('patex_update_script', 'Save JavaScript, Python, or R source in a project', { id: z.string().uuid(), language, source: z.string().max(100000) }, async ({ id, language: selected, source }) => {
    const project = await store.updateScript(id, selected, source);
    return result({ id, language: selected, source: project.scripts[selected], updatedAt: project.updatedAt });
  });
  server.tool('patex_run_script', 'Run the saved JavaScript, Python, or R source and save generated files', { id: z.string().uuid(), language }, async ({ id, language: selected }) => {
    const project = await store.get(id);
    const response = await fetch(`${compilerUrl}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: selected, source: project.scripts[selected] }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Code runner returned ${response.status}`);
    const run = await response.json() as RunResult;
    if (run.ok) await store.saveArtifacts(id, run.artifacts);
    return result({ ok: run.ok, exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, artifacts: await store.listArtifacts(id) });
  });
  server.tool('patex_list_artifacts', 'List generated files available for LaTeX inclusion', { id: z.string().uuid() }, async ({ id }) => result(await store.listArtifacts(id)));
  server.tool('patex_compile', 'Compile a project through the isolated worker', { id: z.string().uuid() }, async ({ id }) => {
    const project = await store.get(id);
    const response = await fetch(`${compilerUrl}/compile`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ latex: project.latex, assets: await store.compileAssets(id) }), signal: AbortSignal.timeout(65000),
    });
    if (!response.ok) throw new Error(`Compiler returned ${response.status}`);
    const compiled = await response.json() as { ok: boolean; log: string; pdfBase64?: string };
    if (compiled.ok && compiled.pdfBase64) {
      if ((await store.get(id)).latex !== project.latex) throw new Error('Source changed; retry compile');
      const bytes = Buffer.from(compiled.pdfBase64, 'base64');
      if (bytes.length > 5_000_000 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid compiled PDF');
      await store.savePdf(id, bytes);
    }
    return result({ ok: compiled.ok, log: compiled.log.slice(-14000) });
  });
  return server;
}
