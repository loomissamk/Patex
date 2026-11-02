import express, { type ErrorRequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ProjectStore } from './store.js';
import { askAI } from './ai.js';
import { createPatexMcpServer } from './mcp-server.js';
import type { AiProvider, CompileResult } from '../shared/types.js';

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
  app.get('/api/projects', async (_req, res, next) => {
    try { res.json(await store.list()); } catch (err) { next(err); }
  });
  app.post('/api/projects', async (req, res, next) => {
    try {
      if (req.body.name != null && typeof req.body.name !== 'string') { res.status(400).json({ error: 'Invalid name' }); return; }
      res.status(201).json(await store.create(req.body.name));
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
  app.get('/api/projects/:id/pdf', async (req, res, next) => {
    try { const pdf = await store.readPdf(req.params.id); res.set('content-type', 'application/pdf').set('cache-control', 'no-store').send(pdf); }
    catch (err) { next(err); }
  });
  app.post('/api/projects/:id/compile', async (req, res, next) => {
    try {
      if (!options.compilerUrl) { res.status(503).json({ error: 'Compiler is not configured' }); return; }
      const project = await store.get(req.params.id);
      const startedSource = project.latex;
      const result = await fetch(`${options.compilerUrl}/compile`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ latex: startedSource }), signal: AbortSignal.timeout(65000),
      });
      if (!result.ok) { res.status(502).json({ error: `Compiler failed: ${result.status}` }); return; }
      const compiled = await result.json() as CompileResult;
      if (compiled.ok && compiled.pdfBase64) {
        // Avoid displaying stale output after a concurrent edit.
        const latest = await store.get(req.params.id);
        if (latest.latex !== startedSource) { res.status(409).json({ error: 'Source changed during compilation; compile again' }); return; }
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
      res.json(await askAI(provider as AiProvider, prompt, project.latex));
    } catch (err) { next(err); }
  });
  app.use('/api', ((_err, _req, res, _next) => {
    const e = _err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || e.message === 'Invalid project ID') res.status(404).json({ error: 'Project not found' });
    else res.status(500).json({ error: e.message.startsWith('Provider') || e.message.includes('configured') ? e.message : 'Internal error' });
  }) satisfies ErrorRequestHandler);
  // Serve Vite's production build; dev mode uses Vite directly.
  const clientDir = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  return app;
}
