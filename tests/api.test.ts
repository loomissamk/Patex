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
  test('rejects invalid request data and path IDs', async () => {
    const app = createApp(new ProjectStore(root));
    await request(app).post('/api/projects').send({ name: 7 }).expect(400);
    await request(app).get('/api/projects/not-a-uuid').expect(404);
  });
  test('MCP endpoint authenticates and lists Patex tools', async () => {
    const app = createApp(new ProjectStore(root), { token: 'test-token' });
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    await request(app).post('/mcp').set('Host', 'localhost').set('Accept', 'application/json, text/event-stream').send(payload).expect(401);
    const response = await request(app).post('/mcp').set('Host', 'localhost').set('Authorization', 'Bearer test-token').set('Accept', 'application/json, text/event-stream').send(payload).expect(200);
    expect(response.text).toContain('patex_list_projects');
  });
});
