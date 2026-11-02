import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ProjectStore } from './store.js';
import { askAI, completeAI, providerStatus, testProvider } from './ai.js';
import { createPatexMcpServer } from './mcp-server.js';
import type { AiProvider, DocumentFormat, RunResult, ScriptLanguage } from '../shared/types.js';
import { artifactName } from '../shared/artifacts.js';
import { readArchive, writeArchive } from './archive.js';
import { projectLimits } from '../shared/project-files.js';
import { buildProject, cancelBuild } from './build.js';
import { compilerRequest } from './compiler-client.js';
import { Accounts, cookieToken, matchesMaster, sessionCookie, type PublicAccount } from './auth.js';
import { publishingIndex } from './publishing.js';
import { publishingTemplates } from '../shared/publishing-templates.js';

export function createApp(store: ProjectStore, options: { token?: string; compilerUrl?: string } = {}) {
  const app = express();
  const accounts = new Accounts(store.dataRoot);
  const selected = (res: Response): ProjectStore => res.locals.store as ProjectStore || store;
  const identity = async (req: Request): Promise<PublicAccount | null> => {
    const cookie = cookieToken(req.header('cookie'));
    if (cookie !== null) return accounts.resolve(cookie, 'session');
    const auth = req.header('authorization') || '';
    if (matchesMaster(auth, options.token)) return await accounts.owner() || { id: 'owner', username: 'Owner', role: 'owner', createdAt: '' };
    if (auth.startsWith('Bearer ')) return accounts.resolve(auth.slice(7), 'api');
    if (!options.token && !(await accounts.list()).length) return { id: 'owner', username: 'Local', role: 'owner', createdAt: '' };
    return null;
  };
  const attempts = new Map<string, { count: number; until: number }>();
  const allow = (key: string, count: number, duration = 60 * 60 * 1000) => {
    if (attempts.size > 5000) for (const [entry, value] of attempts) if (value.until < Date.now()) attempts.delete(entry);
    const current = attempts.get(key);
    const value = current && current.until > Date.now() ? current : { count: 0, until: Date.now() + duration };
    value.count++; attempts.set(key, value); return value.count <= count;
  };
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff').set('Referrer-Policy', 'no-referrer').set('X-Frame-Options', 'DENY');
    if (process.env.NODE_ENV === 'production') res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.use('/auth', (req, res, next) => {
    try { if (req.header('origin') && new URL(req.header('origin')!).host !== req.header('host')) { res.status(403).json({ error: 'Cross-origin requests are not permitted' }); return; } next(); } catch { res.sendStatus(403); }
  });
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'patex' }));
  app.get('/auth/session', async (req, res, next) => { try { res.set('cache-control', 'no-store').json({ user: await identity(req) }); } catch (error) { next(error); } });
  app.post('/auth/login', async (req, res) => {
    if (!allow(`login:${req.socket.remoteAddress}`, 20, 15 * 60 * 1000)) { res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' }); return; }
    try {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 128) throw new Error('Invalid login');
      const result = await accounts.login(username, password);
      res.setHeader('Set-Cookie', sessionCookie(result.token)); res.json({ user: result.user });
    } catch { res.status(401).json({ error: 'Invalid username or password' }); }
  });
  app.post('/auth/invite', async (req, res) => {
    try {
      if (typeof req.body?.token !== 'string' || req.body.token.length > 100) throw new Error('Invalid invitation');
      const result = await accounts.exchangeInvite(req.body.token);
      res.setHeader('Set-Cookie', sessionCookie(result.token)); res.json({ user: result.user });
    } catch { res.status(401).json({ error: 'Invitation is invalid or expired' }); }
  });
  app.post('/auth/owner', async (req, res, next) => {
    try {
    if (!matchesMaster(req.header('authorization') || '', options.token)) { res.status(401).json({ error: 'Invalid owner access token' }); return; }
    const owner = await accounts.owner() || await accounts.create('samuel', true);
    const result = await accounts.exchangeInvite(await accounts.invite(owner.id));
    res.setHeader('Set-Cookie', sessionCookie(result.token)); res.json({ user: result.user });
    } catch (error) { next(error); }
  });
  app.post('/auth/logout', async (req, res) => { const token = cookieToken(req.header('cookie')); if (token) await accounts.revoke(token); res.setHeader('Set-Cookie', sessionCookie('')); res.sendStatus(204); });
  app.use(['/api', '/mcp'], async (req, res, next) => {
    try {
      const origin = req.header('origin');
      if (origin && new URL(origin).host !== req.header('host')) { res.status(403).json({ error: 'Cross-origin requests are not permitted' }); return; }
      const user = await identity(req);
      if (!user) { res.status(401).json({ error: 'Sign in to your Patex workspace' }); return; }
      res.locals.user = user;
      res.locals.store = user.role === 'owner' ? store : store.workspace(user.id);
      const job = /\/compile$|\/run\//.test(req.originalUrl) ? 'compute' : /\/complete$|\/assist$/.test(req.originalUrl) ? 'ai' : '';
      if (job && !allow(`${user.id}:${job}`, job === 'ai' ? 600 : 300)) { res.set('Retry-After', '3600').status(429).json({ error: 'Hourly workspace usage limit reached' }); return; }
      next();
    } catch { res.status(403).json({ error: 'Invalid authentication or origin' }); }
  });
  app.get('/api/account', (_req, res) => res.json({ user: res.locals.user }));
  app.get('/api/runtime', async (_req, res, next) => { try { if (!options.compilerUrl) throw new Error('Compiler not configured'); res.json(await compilerRequest(options.compilerUrl, 'status', {})); } catch (error) { next(error); } });
  app.post('/api/account/password', async (req, res, next) => { try { const user = res.locals.user as PublicAccount; await accounts.setPassword(user.id, req.body?.password); res.sendStatus(204); } catch (error) { next(error); } });
  app.post('/api/account/api-token', async (_req, res, next) => { try { res.json({ token: await accounts.apiToken((res.locals.user as PublicAccount).id), expiresInDays: 30 }); } catch (error) { next(error); } });
  app.use('/api/admin', (_req, res, next) => { if ((res.locals.user as PublicAccount).role !== 'owner') { res.status(403).json({ error: 'Owner access required' }); return; } next(); });
  app.get('/api/admin/users', async (_req, res, next) => { try { res.json(await accounts.list()); } catch (error) { next(error); } });
  app.post('/api/admin/users', async (req, res, next) => { try { const user = await accounts.create(req.body?.username); res.status(201).json({ user, invite: await accounts.invite(user.id) }); } catch (error) { next(error); } });
  app.post('/api/admin/users/:id/invite', async (req, res, next) => { try { res.json({ invite: await accounts.invite(req.params.id) }); } catch (error) { next(error); } });
  app.put('/api/admin/users/:id', async (req, res, next) => { try { if (typeof req.body?.disabled !== 'boolean') throw new Error('Invalid account setting'); await accounts.disable(req.params.id, req.body.disabled); res.sendStatus(204); } catch (error) { next(error); } });
  // Fresh MCP server and transport for each request prevents cross-client state leaks.
  app.all('/mcp', async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const allowed = new Set((process.env.PATEX_MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1').split(',').map(x => x.trim().toLowerCase()));
    const host = (req.header('host') || '').split(':')[0].toLowerCase();
    let originHost = '';
    try { if (req.header('origin')) originHost = new URL(req.header('origin')!).hostname.toLowerCase(); }
    catch { res.status(403).json({ error: 'Forbidden' }); return; }
    if (!allowed.has(host) || (originHost && !allowed.has(originHost))) {
      res.status(403).json({ error: 'Forbidden' }); return;
    }
    const server = createPatexMcpServer(selected(res), options.compilerUrl || 'http://127.0.0.1:3001');
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
  app.get('/api/integrations', (_req, res) => res.json({
    llamafarm: { configured: Boolean(process.env.LLAMAFARM_CHAT_URL && process.env.LLAMAFARM_MODEL), model: process.env.LLAMAFARM_MODEL || '', status: providerStatus('llamafarm') },
    anthropic: { configured: Boolean(process.env.ANTHROPIC_API_KEY), model: process.env.ANTHROPIC_MODEL || '', status: providerStatus('anthropic') },
    openai: { configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || '', status: providerStatus('openai') },
    mcp: { configured: Boolean(options.token) },
  }));
  app.post('/api/integrations/:provider/test', async (req, res) => {
    if (!['llamafarm', 'anthropic', 'openai'].includes(req.params.provider)) { res.status(400).json({ error: 'Invalid provider' }); return; }
    res.json(await testProvider(req.params.provider as AiProvider));
  });
  app.get('/api/projects', async (_req, res, next) => {
    try { res.json(await selected(res).list(_req.query.archived === 'true')); } catch (err) { next(err); }
  });
  app.post('/api/projects/import/inspect', express.raw({ type: 'application/zip', limit: '32mb' }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'Upload a ZIP project' }); return; }
      const archive = await readArchive(req.body);
      res.json({ candidates: archive.candidates, mainFile: archive.mainFile, count: archive.files.length, ignored: archive.ignored });
    } catch (error) { next(error); }
  });
  app.post('/api/projects/import', express.raw({ type: 'application/zip', limit: '32mb' }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'Upload a ZIP project' }); return; }
      const archive = await readArchive(req.body);
      const mainFile = typeof req.query.main === 'string' ? req.query.main : archive.mainFile;
      if (!mainFile || !archive.candidates.includes(mainFile)) { res.status(400).json({ error: 'Select the main document from the archive' }); return; }
      res.status(201).json(await selected(res).importProject(typeof req.query.name === 'string' ? req.query.name : 'Imported project', mainFile, archive.files, archive.engine));
    } catch (error) { next(error); }
  });
  app.post('/api/projects', async (req, res, next) => {
    try {
      if (req.body.name != null && typeof req.body.name !== 'string') { res.status(400).json({ error: 'Invalid name' }); return; }
      const format = req.body.format || 'tex';
      if (!['tex', 'rmd', 'qmd'].includes(format)) { res.status(400).json({ error: 'Invalid document format' }); return; }
      const project = await selected(res).create(req.body.name, format as DocumentFormat);
      if (format === 'tex' && typeof req.body.template === 'string' && req.body.template in publishingTemplates) {
        res.status(201).json(await selected(res).update(project.id, { latex: publishingTemplates[req.body.template as keyof typeof publishingTemplates].source })); return;
      }
      res.status(201).json(project);
    } catch (err) { next(err); }
  });
  app.get('/api/projects/:id', async (req, res, next) => {
    try { res.json(await selected(res).get(req.params.id)); } catch (err) { next(err); }
  });
  app.put('/api/projects/:id', async (req, res, next) => {
    try {
      const { latex, name, engine } = req.body;
      if ((latex !== undefined && (typeof latex !== 'string' || Buffer.byteLength(latex) > projectLimits.sourceBytes)) || (name !== undefined && typeof name !== 'string') || (engine !== undefined && !['pdflatex', 'xelatex', 'lualatex'].includes(engine))) {
        res.status(400).json({ error: 'Invalid project content' }); return;
      }
      res.json(await selected(res).update(req.params.id, { latex, name, engine }));
    } catch (err) { next(err); }
  });
  app.get('/api/projects/:id/export', async (req, res, next) => {
    try { const project = await selected(res).get(req.params.id); const zip = await writeArchive(await selected(res).exportFiles(project.id)); res.set('content-type', 'application/zip').set('content-disposition', `attachment; filename="${project.name.replace(/[^a-z0-9_-]/gi, '_')}.zip"`).send(zip); } catch (error) { next(error); }
  });
  app.get('/api/projects/:id/files', async (req, res, next) => {
    try { res.json(await selected(res).listFiles(req.params.id)); } catch (error) { next(error); }
  });
  app.get('/api/projects/:id/publishing', async (req, res, next) => {
    try { const project = await selected(res).get(req.params.id); res.json(publishingIndex(await selected(res).compileFiles(project.id), project.mainFile)); } catch (error) { next(error); }
  });
  app.get('/api/projects/:id/files/content', async (req, res, next) => {
    try { if (typeof req.query.name !== 'string') throw new Error('Invalid project file path'); res.set('content-type', 'application/octet-stream').set('cache-control', 'no-store').send(await selected(res).readFile(req.params.id, req.query.name)); } catch (error) { next(error); }
  });
  app.put('/api/projects/:id/files/content', express.raw({ type: () => true, limit: '8mb' }), async (req, res, next) => {
    try { if (typeof req.query.name !== 'string' || !Buffer.isBuffer(req.body)) throw new Error('Invalid project file upload'); await selected(res).saveFiles(req.params.id, [{ name: req.query.name, base64: req.body.toString('base64') }]); res.json(await selected(res).listFiles(req.params.id)); } catch (error) { next(error); }
  });
  app.delete('/api/projects/:id/files', async (req, res, next) => {
    try { if (typeof req.query.name !== 'string') throw new Error('Invalid project file path'); await selected(res).removeFile(req.params.id, req.query.name); res.sendStatus(204); } catch (error) { next(error); }
  });
  app.put('/api/projects/:id/archive', async (req, res, next) => {
    try { if (typeof req.body.archived !== 'boolean') throw new Error('Invalid archive setting'); res.json(await selected(res).update(req.params.id, { archived: req.body.archived })); } catch (error) { next(error); }
  });
  app.get('/api/projects/:id/history', async (req, res, next) => {
    try { res.json(await selected(res).revisions(req.params.id)); } catch (error) { next(error); }
  });
  app.post('/api/projects/:id/history/:revision/restore', async (req, res, next) => {
    try { res.json(await selected(res).restore(req.params.id, req.params.revision)); } catch (error) { next(error); }
  });
  app.post('/api/projects/:id/cancel-build', async (req, res, next) => {
    try { await selected(res).get(req.params.id); cancelBuild(selected(res), req.params.id); res.sendStatus(204); } catch (error) { next(error); }
  });
  app.post('/api/projects/:id/source-map', async (req, res, next) => {
    try {
      const project = await selected(res).get(req.params.id); const build = await selected(res).readBuild(project.id);
      if (!build?.synctexBase64 || !options.compilerUrl) { res.status(400).json({ error: 'Source navigation is available after a successful native TeX build' }); return; }
      if (!['forward', 'inverse'].includes(req.body?.mode)) throw new Error('Invalid source navigation request');
      res.json(await compilerRequest(options.compilerUrl, 'source-map', { mode: req.body.mode, file: req.body.file || project.mainFile, line: req.body.line, page: req.body.page, x: req.body.x, y: req.body.y, pdfBase64: (await selected(res).readPdf(project.id)).toString('base64'), synctexBase64: build.synctexBase64, sourceRoot: build.sourceRoot }));
    } catch (error) { next(error); }
  });
  app.put('/api/projects/:id/bibliography', async (req, res, next) => {
    try {
      const bibliography = req.body?.bibliography;
      if (typeof bibliography !== 'string' || Buffer.byteLength(bibliography, 'utf8') > 100_000) { res.status(400).json({ error: 'Invalid bibliography' }); return; }
      const project = await selected(res).updateBibliography(req.params.id, bibliography);
      res.json({ bibliography: project.bibliography, updatedAt: project.updatedAt });
    } catch (err) { next(err); }
  });
  app.put('/api/projects/:id/feedback-settings', async (req, res, next) => {
    try {
      if (typeof req.body?.enabled !== 'boolean') { res.status(400).json({ error: 'Invalid feedback setting' }); return; }
      const project = await selected(res).setFeedbackEnabled(req.params.id, req.body.enabled);
      res.json({ enabled: project.feedbackEnabled });
    } catch (err) { next(err); }
  });
  app.get('/api/projects/:id/feedback', async (req, res, next) => {
    try { res.set('cache-control', 'no-store').json(await selected(res).readFeedback(req.params.id)); } catch (err) { next(err); }
  });
  app.post('/api/projects/:id/feedback', async (req, res, next) => {
    try {
      const { provider, decision, sourceBefore, suggestion, sourceAfter } = req.body || {};
      if (!['llamafarm', 'anthropic', 'openai'].includes(provider) || !['accepted', 'rejected'].includes(decision) ||
        [sourceBefore, suggestion, sourceAfter].some(value => typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 30_000)) {
        res.status(400).json({ error: 'Invalid feedback event' }); return;
      }
      res.status(201).json(await selected(res).recordFeedback(req.params.id, { provider, decision, sourceBefore, suggestion, sourceAfter }));
    } catch (err) { next(err); }
  });
  app.delete('/api/projects/:id/feedback', async (req, res, next) => {
    try { await selected(res).deleteFeedback(req.params.id); res.status(204).end(); } catch (err) { next(err); }
  });
  app.put('/api/projects/:id/scripts/:language', async (req, res, next) => {
    try {
      const language = req.params.language as ScriptLanguage;
      const source = req.body?.source;
      if (!['javascript', 'python', 'r'].includes(language) || typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 100_000) { res.status(400).json({ error: 'Invalid language or source' }); return; }
      const project = await selected(res).updateScript(req.params.id, language, source);
      res.json({ language, source: project.scripts[language], updatedAt: project.updatedAt });
    } catch (err) { next(err); }
  });
  app.post('/api/projects/:id/run/:language', async (req, res, next) => {
    try {
      const language = req.params.language as ScriptLanguage;
      const source = req.body?.source;
      if (!['javascript', 'python', 'r'].includes(language) || typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 100_000) { res.status(400).json({ error: 'Invalid language or source' }); return; }
      if (!options.compilerUrl) { res.status(503).json({ error: 'Code runner is not configured' }); return; }
      await selected(res).updateScript(req.params.id, language, source);
      const result = await compilerRequest<RunResult>(options.compilerUrl, 'run', { language, source });
      if (result.ok) await selected(res).saveArtifacts(req.params.id, result.artifacts);
      res.json({ ok: result.ok, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, artifacts: result.ok ? await selected(res).listArtifacts(req.params.id) : [] });
    } catch (err) { next(err); }
  });
  app.get('/api/projects/:id/artifacts', async (req, res, next) => {
    try { res.json(await selected(res).listArtifacts(req.params.id)); } catch (err) { next(err); }
  });
  app.get('/api/projects/:id/artifacts/:name', async (req, res, next) => {
    try {
      const name = req.params.name;
      if (!artifactName.test(name)) { res.status(400).json({ error: 'Invalid artifact name' }); return; }
      const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg' : name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.csv') ? 'text/csv' : 'text/plain';
      res.set('content-type', type).set('cache-control', 'no-store').send(await selected(res).readArtifact(req.params.id, name));
    } catch (err) { next(err); }
  });
  app.delete('/api/projects/:id/artifacts/:name', async (req, res, next) => {
    try { await selected(res).deleteArtifact(req.params.id, req.params.name); res.status(204).end(); } catch (err) { next(err); }
  });
  app.get('/api/projects/:id/pdf', async (req, res, next) => {
    try { const pdf = await selected(res).readPdf(req.params.id); res.set('content-type', 'application/pdf').set('cache-control', 'no-store').send(pdf); }
    catch (err) { next(err); }
  });
  app.post('/api/projects/:id/compile', async (req, res, next) => {
    try {
      if (!options.compilerUrl) { res.status(503).json({ error: 'Compiler is not configured' }); return; }
      res.json(await buildProject(selected(res), req.params.id, options.compilerUrl, req.body?.force === true));
    } catch (err) { next(err); }
  });
  app.post('/api/assist', async (req, res, next) => {
    const controller = new AbortController(); res.on('close', () => controller.abort());
    try {
      const { provider, prompt, projectId, selection, diagnostics = '' } = req.body;
      if (!['llamafarm', 'anthropic', 'openai'].includes(provider) || typeof prompt !== 'string' || prompt.length > 4000) {
        res.status(400).json({ error: 'Invalid provider or prompt' }); return;
      }
      const project = await selected(res).get(projectId);
      if (selection && (!Number.isInteger(selection.from) || !Number.isInteger(selection.to) || selection.from < 0 || selection.to <= selection.from || selection.to > project.latex.length || selection.to - selection.from > 12000)) throw new Error('Invalid selected passage');
      res.json(await askAI(provider as AiProvider, prompt, project.latex, project.format, selection, typeof diagnostics === 'string' ? diagnostics : '', controller.signal));
    } catch (err) { if (!controller.signal.aborted) next(err); }
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
    if ((e as NodeJS.ErrnoException & { type?: string }).type === 'entity.too.large') res.status(413).json({ error: 'Upload exceeds the size limit' });
    else if (e.code === 'ENOENT' || e.message === 'Invalid project ID') res.status(404).json({ error: 'Project or artifact not found' });
    else if (e.message === 'Feedback capture is off') res.status(403).json({ error: e.message });
    else if (/Invalid|limit|exceeds|exceeded|Choose|Select|ZIP|Archive|archive|Duplicate|Manifest|missing main|Cannot remove|Update the main|Use a |Username|Account unavailable|conflicts/.test(e.message)) res.status(400).json({ error: e.message });
    else if (e.name === 'TimeoutError') res.status(503).json({ error: 'Provider or build timed out. Try again shortly.' });
    else if (/superseded|Source changed/.test(e.message) || e.name === 'AbortError') res.status(409).json({ error: 'Build cancelled or superseded by a newer revision' });
    else res.status(500).json({ error: e.message.startsWith('Provider') || e.message.includes('configured') ? e.message : 'Internal error' });
  }) satisfies ErrorRequestHandler);
  // Serve Vite's production build; dev mode uses Vite directly.
  const clientDir = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  return app;
}
