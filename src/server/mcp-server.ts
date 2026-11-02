import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ProjectStore } from './store.js';
import type { RunResult } from '../shared/types.js';
import { compilerRequest } from './compiler-client.js';
import { buildProject } from './build.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

export function createPatexMcpServer(store: ProjectStore, compilerUrl: string): McpServer {
  const server = new McpServer({ name: 'patex', version: '0.1.0' });
  server.tool('patex_list_projects', 'List Patex projects', {}, async () => result(await store.list()));
  server.tool('patex_get_project', 'Read LaTeX source from a Patex project', { id: z.string().uuid() }, async ({ id }) => result(await store.get(id)));
  server.tool('patex_create_project', 'Create a TeX, R Markdown, or Quarto document', { name: z.string().max(100), format: z.enum(['tex', 'rmd', 'qmd']).optional() }, async ({ name, format }) => result(await store.create(name, format || 'tex')));
  server.tool('patex_update_latex', 'Replace the main document source in a project', { id: z.string().uuid(), latex: z.string().max(1_000_000) }, async ({ id, latex }) => result(await store.update(id, { latex })));
  server.tool('patex_list_files', 'List all project source, data, bibliography, and figure files', { id: z.string().uuid() }, async ({ id }) => result(await store.listFiles(id)));
  server.tool('patex_read_file', 'Read a project text file', { id: z.string().uuid(), name: z.string().max(240) }, async ({ id, name }) => { const bytes = await store.readFile(id, name); if (bytes.length > 1_000_000 || bytes.includes(0)) throw new Error('Read text files under 1 MB'); return result({ name, text: bytes.toString('utf8') }); });
  server.tool('patex_update_file', 'Edit or add a supporting project text file', { id: z.string().uuid(), name: z.string().max(240), text: z.string().max(1_000_000) }, async ({ id, name, text }) => {
    const project = await store.get(id);
    if (name === project.mainFile) await store.update(id, { latex: text });
    else if (name === 'references.bib') await store.updateBibliography(id, text);
    else await store.saveFiles(id, [{ name, base64: Buffer.from(text).toString('base64') }]);
    return result(await store.listFiles(id));
  });
  server.tool('patex_list_history', 'List recoverable project revisions', { id: z.string().uuid() }, async ({ id }) => result(await store.revisions(id)));
  server.tool('patex_update_bibliography', 'Save BibTeX entries in references.bib', { id: z.string().uuid(), bibliography: z.string().max(100000) }, async ({ id, bibliography }) => result(await store.updateBibliography(id, bibliography)));
  const language = z.enum(['javascript', 'python', 'r']);
  server.tool('patex_update_script', 'Save JavaScript, Python, or R source in a project', { id: z.string().uuid(), language, source: z.string().max(100000) }, async ({ id, language: selected, source }) => {
    const project = await store.updateScript(id, selected, source);
    return result({ id, language: selected, source: project.scripts[selected], updatedAt: project.updatedAt });
  });
  server.tool('patex_run_script', 'Run the saved JavaScript, Python, or R source and save generated files', { id: z.string().uuid(), language }, async ({ id, language: selected }) => {
    const project = await store.get(id);
    const run = await compilerRequest<RunResult>(compilerUrl, 'run', { language: selected, source: project.scripts[selected] });
    if (run.ok) await store.saveArtifacts(id, run.artifacts);
    return result({ ok: run.ok, exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, artifacts: await store.listArtifacts(id) });
  });
  server.tool('patex_list_artifacts', 'List generated files available for LaTeX inclusion', { id: z.string().uuid() }, async ({ id }) => result(await store.listArtifacts(id)));
  server.tool('patex_compile', 'Compile a project through the isolated worker', { id: z.string().uuid() }, async ({ id }) => {
    return result(await buildProject(store, id, compilerUrl));
  });
  return server;
}
