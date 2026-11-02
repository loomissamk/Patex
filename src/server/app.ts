import express, { type ErrorRequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ProjectStore } from './store.js';
import { askAI, completeAI } from './ai.js';
import { createPatexMcpServer } from './mcp-server.js';
import type { AiProvider, CompileResult, DocumentFormat, RunResult, ScriptLanguage } from '../shared/types.js';
import { artifactName } from '../shared/artifacts.js';

export function createApp(store: ProjectStore, options: { token?: string; compilerUrl?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '250kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'patex' }));
  // Fresh MCP server and transport for each request prevents cross-client state leaks.
  app.all('/mcp', async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const expected = options.token ? Buffer.from(`Bearer ${options.token}`) : null;
    const actual = Buffer.from(req.header('authorization') || '');
    if (!expected || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    const allowed = new Set((process.env.PATEX_MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1').split(',').map(x => x.trim().toLowerCase()));
    const host = (req.header('host') || '').split(':')[0].toLowerCase();
    let originHost = '';
    try { if (req.header('origin')) originHost = new URL(req.header('origin')!).hostname.toLowerCase(); }
    catch { res.status(403).json({ error: 'Forbidden' }); return; }
    if (!allowed.has(host) || (originHost && !allowed.has(originHost))) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    const server = createPatexMcpServer(store, options.compilerUrl || 'http://127.0.0.1:3001');
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
    } finally {
      await server.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  });
  app.use('/api', (req, res, next) => {
    if (!options.token) { next(); return; }
    const auth = req.header('authorization') || '';
    if (auth !== `Bearer ${options.token}`) { res.status(401).json({ error: 'Invalid access token' }); return; }
    next();
  });
  app.get('/api/integrations', (_req, res) => res.json({
    llamafarm: { configured: Boolean(process.env.LLAMAFARM_CHAT_URL && process.env.LLAMAFARM_MODEL), model: process.env.LLAMAFARM_MODEL || '' },
    anthropic: { configured: Boolean(process.env.ANTHROPIC_API_KEY), model: process.env.ANTHROPIC_MODEL || '' },
    openai: { configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || '' },
    mcp: { configured: Boolean(options.token) },
  }));
  app.get('/api/projects', async (_req, res, next) => {
    try { res.json(await store.list()); } catch (err) { next(err); }
  });
  app.post('/api/projects', async (req, res, next) => {
    try {
      if (req.body.name != null && typeof req.body.name !== 'string') { res.status(400).json({ error: 'Invalid name' }); return; }
      const format = req.body.format || 'tex';
      if (!['tex', 'rmd', 'qmd'].includes(format)) { res.status(400).json({ error: 'Invalid document format' }); return; }
      res.status(201).json(await store.create(req.body.name, format as DocumentFormat));
    } catch (err) { next(err); }
  });
  app.get('/api/projects/:id', async (req, res, next) => {
    try { res.json(await store.get(req.params.id)); } catch (err) { next(err); }
  });
  app.put('/api/projects/:id', async (req, res, next) => {
    try {
      const { latex, name } = req.body;
      if ((latex !== undefined && (typeof latex !== 'string' || latex.length > 200_000)) || (name !== undefined && typeof name !== 'string')) {
        res.status(400).json({ error: 'Invalid project content' }); return;
      }
      res.json(await store.update(req.params.id, { latex, name }));
    } catch (err) { next(err); }
  });
  app.put('/api/projects/:id/bibliography', async (req, res, next) => {
    try {
      const bibliography = req.body?.bibliography;
      if (typeof bibliography !== 'string' || Buffer.byteLength(bibliography, 'utf8') > 100_000) { res.status(400).json({ error: 'Invalid bibliography' }); return; }
      const project = await store.updateBibliography(req.params.id, bibliography);
      res.json({ bibliography: project.bibliography, updatedAt: project.updatedAt });
    } catch (err) { next(err); }
  });
  app.put('/api/projects/:id/feedback-settings', async (req, res, next) => {
    try {
      if (typeof req.body?.enabled !== 'boolean') { res.status(400).json({ error: 'Invalid feedback setting' }); return; }
      const project = await store.setFeedbackEnabled(req.params.id, req.body.enabled);
      res.json({ enabled: project.feedbackEnabled });
    } catch (err) { next(err); }
  });
  app.get('/api/projects/:id/feedback', async (req, res, next) => {
    try { res.set('cache-control', 'no-store').json(await store.readFeedback(req.params.id)); } catch (err) { next(err); }
  });
  app.post('/api/projects/:id/feedback', async (req, res, next) => {
    try {
      const { provider, decision, sourceBefore, suggestion, sourceAfter } = req.body || {};
      if (!['llamafarm', 'anthropic', 'openai'].includes(provider) || !['accepted', 'rejected'].includes(decision) ||
        [sourceBefore, suggestion, sourceAfter].some(value => typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 30_000)) {
        res.status(400).json({ error: 'Invalid feedback event' }); return;
      }
      res.status(201).json(await store.recordFeedback(req.params.id, { provider, decision, sourceBefore, suggestion, sourceAfter }));
    } catch (err) { next(err); }
  });
  app.delete('/api/projects/:id/feedback', async (req, res, next) => {
    try { await store.deleteFeedback(req.params.id); res.status(204).end(); } catch (err) { next(err); }
  });
  app.put('/api/projects/:id/scripts/:language', async (req, res, next) => {
    try {
      const language = req.params.language as ScriptLanguage;
      const source = req.body?.source;
      if (!['javascript', 'python', 'r'].includes(language) || typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 100_000) { res.status(400).json({ error: 'Invalid language or source' }); return; }
      const project = await store.updateScript(req.params.id, language, source);
      res.json({ language, source: project.scripts[language], updatedAt: project.updatedAt });
    } catch (err) { next(err); }
  });
  app.post('/api/projects/:id/run/:language', async (req, res, next) => {
    try {
      const language = req.params.language as ScriptLanguage;
      const source = req.body?.source;
      if (!['javascript', 'python', 'r'].includes(language) || typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 100_000) { res.status(400).json({ error: 'Invalid language or source' }); return; }
      if (!options.compilerUrl) { res.status(503).json({ error: 'Code runner is not configured' }); return; }
      await store.updateScript(req.params.id, language, source);
      const worker = await fetch(`${options.compilerUrl}/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language, source }), signal: AbortSignal.timeout(20000),
      });
      if (!worker.ok) { res.status(502).json({ error: `Code runner failed: ${worker.status}` }); return; }
      const result = await worker.json() as RunResult;
      if (result.ok) await store.saveArtifacts(req.params.id, result.artifacts);
      res.json({ ok: result.ok, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, artifacts: result.ok ? await store.listArtifacts(req.params.id) : [] });
    } catch (err) { next(err); }
  });
  app.get('/api/projects/:id/artifacts', async (req, res, next) => {
    try { res.json(await store.listArtifacts(req.params.id)); } catch (err) { next(err); }
  });
  app.get('/api/projects/:id/artifacts/:name', async (req, res, next) => {
    try {
      const name = req.params.name;
      if (!artifactName.test(name)) { res.status(400).json({ error: 'Invalid artifact name' }); return; }
      const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg' : name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.csv') ? 'text/csv' : 'text/plain';
      res.set('content-type', type).set('cache-control', 'no-store').send(await store.readArtifact(req.params.id, name));
    } catch (err) { next(err); }
  });
  app.delete('/api/projects/:id/artifacts/:name', async (req, res, next) => {
    try { await store.deleteArtifact(req.params.id, req.params.name); res.status(204).end(); } catch (err) { next(err); }
  });
  app.get('/api/projects/:id/pdf', async (req, res, next) => {
    try { const pdf = await store.readPdf(req.params.id); res.set('content-type', 'application/pdf').set('cache-control', 'no-store').send(pdf); }
    catch (err) { next(err); }
  });
  app.post('/api/projects/:id/compile', async (req, res, next) => {
    try {
      if (!options.compilerUrl) { res.status(503).json({ error: 'Compiler is not configured' }); return; }
      const project = await store.get(req.params.id);
      const startedSource = project.latex;
      const startedBibliography = project.bibliography;
      const result = await fetch(`${options.compilerUrl}/compile`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ latex: startedSource, format: project.format, bibliography: project.bibliography, assets: await store.compileAssets(req.params.id) }), signal: AbortSignal.timeout(130000),
      });
      if (!result.ok) { res.status(502).json({ error: `Compiler failed: ${result.status}` }); return; }
      const compiled = await result.json() as CompileResult;
      if (compiled.ok && compiled.pdfBase64) {
        // Avoid displaying stale output after a concurrent edit.
        const latest = await store.get(req.params.id);
        if (latest.latex !== startedSource || latest.bibliography !== startedBibliography) { res.status(409).json({ error: 'Source changed during compilation; compile again' }); return; }
        const bytes = Buffer.from(compiled.pdfBase64, 'base64');
        if (bytes.length > 5_000_000 || bytes.subarray(0, 5).toString() !== '%PDF-') { res.status(502).json({ error: 'Invalid PDF returned by compiler' }); return; }
        await store.savePdf(req.params.id, bytes);
      }
      res.json({ ok: compiled.ok, log: compiled.log.slice(-14000) });
    } catch (err) { next(err); }
  });
  app.post('/api/assist', async (req, res, next) => {
    try {
      const { provider, prompt, projectId } = req.body;
      if (!['llamafarm', 'anthropic', 'openai'].includes(provider) || typeof prompt !== 'string' || prompt.length > 4000) {
        res.status(400).json({ error: 'Invalid provider or prompt' }); return;
      }
      const project = await store.get(projectId);
      res.json(await askAI(provider as AiProvider, prompt, project.latex, project.format));
    } catch (err) { next(err); }
  });
  app.post('/api/complete', async (req, res, next) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const { provider, prefix, suffix, format = 'tex' } = req.body;
      if (!['llamafarm', 'anthropic', 'openai'].includes(provider) || !['tex', 'rmd', 'qmd'].includes(format) || typeof prefix !== 'string' || typeof suffix !== 'string' || prefix.length > 4000 || suffix.length > 2000) {
        res.status(400).json({ error: 'Invalid completion request' }); return;
      }
      res.json({ text: await completeAI(provider as AiProvider, prefix, suffix, format as DocumentFormat, controller.signal) });
    } catch (err) { if (!controller.signal.aborted) next(err); }
  });
  app.use('/api', ((_err, _req, res, _next) => {
    const e = _err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || e.message === 'Invalid project ID') res.status(404).json({ error: 'Project or artifact not found' });
    else if (e.message === 'Feedback capture is off') res.status(403).json({ error: e.message });
    else if (e.message.startsWith('Invalid artifact') || e.message.includes('artifact limit') || e.message.includes('Artifact exceeds') || e.message === 'Feedback storage limit exceeded') res.status(400).json({ error: e.message });
    else res.status(500).json({ error: e.message.startsWith('Provider') || e.message.includes('configured') ? e.message : 'Internal error' });
  }) satisfies ErrorRequestHandler);
  // Serve Vite's production build; dev mode uses Vite directly.
  const clientDir = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  return app;
}
