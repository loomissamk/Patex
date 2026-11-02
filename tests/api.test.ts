import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app.js';
import { ProjectStore } from '../src/server/store.js';
describe('HTTP API', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'patex-api-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  test('enforces bearer auth and creates project', async () => {
    const app = createApp(new ProjectStore(root), { token: 'test-token' });
    await request(app).get('/api/projects').expect(401);
    const res = await request(app).post('/api/projects').set('Authorization', 'Bearer test-token').send({ name: 'Paper' }).expect(201);
    expect(res.body.name).toBe('Paper');
    const list = await request(app).get('/api/projects').set('Authorization', 'Bearer test-token').expect(200);
    expect(list.body).toHaveLength(1);
  });
  test('reports an unavailable worker without losing the source', async () => {
    const app = createApp(new ProjectStore(root), { compilerUrl: 'unix:/nonexistent/patex-worker.sock' });
    const p = await request(app).post('/api/projects').send({ name: 'Saved paper' }).expect(201);
    const result = await request(app).post(`/api/projects/${p.body.id}/compile`).send({ force: true }).expect(503);
    expect(result.body.error).toContain('Your edits are saved');
    const saved = await request(app).get(`/api/projects/${p.body.id}`).expect(200);
    expect(saved.body.latex).toBe(p.body.latex);
  });
  test('rejects invalid request data and path IDs', async () => {
    const app = createApp(new ProjectStore(root));
    await request(app).post('/api/projects').send({ name: 7 }).expect(400);
    await request(app).post('/api/projects').send({ name: 'Bad', format: 'docx' }).expect(400);
    const rmd = await request(app).post('/api/projects').send({ name: 'Research', format: 'rmd' }).expect(201);
    expect(rmd.body.format).toBe('rmd');
    expect(rmd.body.latex).toContain('```{r}');
    await request(app).put(`/api/projects/${rmd.body.id}/bibliography`).send({ bibliography: '@article{key, title={Paper}}' }).expect(200);
    const stored = await request(app).get(`/api/projects/${rmd.body.id}`).expect(200);
    expect(stored.body.bibliography).toContain('@article{key');
    await request(app).get('/api/projects/not-a-uuid').expect(404);
  });
  test('MCP endpoint authenticates and lists Patex tools', async () => {
    const app = createApp(new ProjectStore(root), { token: 'test-token' });
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    await request(app).post('/mcp').set('Host', 'localhost').set('Accept', 'application/json, text/event-stream').send(payload).expect(401);
    const response = await request(app).post('/mcp').set('Host', 'localhost').set('Authorization', 'Bearer test-token').set('Accept', 'application/json, text/event-stream').send(payload).expect(200);
    expect(response.text).toContain('patex_list_projects');
    expect(response.text).toContain('patex_update_script');
    expect(response.text).toContain('patex_run_script');
    expect(response.text).toContain('patex_list_artifacts');
  });
  test('requires explicit consent before storing AI feedback', async () => {
    const app = createApp(new ProjectStore(root));
    const created = await request(app).post('/api/projects').send({ name: 'Paper' }).expect(201);
    const id = created.body.id as string;
    const event = { provider: 'llamafarm', decision: 'rejected', sourceBefore: 'a', suggestion: 'b', sourceAfter: 'a' };
    await request(app).post(`/api/projects/${id}/feedback`).send(event).expect(403);
    await request(app).put(`/api/projects/${id}/feedback-settings`).send({ enabled: true }).expect(200);
    await request(app).post(`/api/projects/${id}/feedback`).send(event).expect(201);
    const exported = await request(app).get(`/api/projects/${id}/feedback`).expect(200);
    expect(exported.body).toHaveLength(1);
    await request(app).delete(`/api/projects/${id}/feedback`).expect(204);
  });
});
