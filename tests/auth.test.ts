import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/server/auth.js';
import { ProjectStore } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
test('one-use invitations and sessions keep guest projects out of the owner workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'patex-accounts-'));
  try {
    const accounts = new Accounts(root); const owner = await accounts.create('samuel', true);
    const app = createApp(new ProjectStore(root), { token: 'owner-secret' });
    const ownerProject = await request(app).post('/api/projects').set('Authorization', 'Bearer owner-secret').send({ name: 'Private owner' }).expect(201);
    const member = await accounts.create('researcher'); const invite = await accounts.invite(member.id);
    const accepted = await request(app).post('/auth/invite').send({ token: invite }).expect(200);
    const cookie = accepted.headers['set-cookie'][0].split(';')[0];
    await request(app).post('/auth/invite').send({ token: invite }).expect(401);
    await request(app).get('/api/projects').set('Cookie', cookie).set('Authorization', 'Bearer owner-secret').expect(200, []);
    await request(app).get(`/api/projects/${ownerProject.body.id}`).set('Cookie', cookie).expect(404);
    await request(app).post('/api/projects').set('Cookie', cookie).send({ name: 'Member paper' }).expect(201);
    const owners = await request(app).get('/api/projects').set('Authorization', 'Bearer owner-secret').expect(200);
    expect(owners.body.map((p: { name: string }) => p.name)).toEqual(['Private owner']);
    await request(app).post('/api/admin/users').set('Cookie', cookie).send({ username: 'intruder' }).expect(403);
    await request(app).post('/api/projects').set('Cookie', cookie).set('Origin', 'http://evil.example').send({ name: 'CSRF' }).expect(403);
    await accounts.setPassword(member.id, 'a long test password');
    await request(app).post('/auth/login').set('Origin', 'https://evil.example').send({ username: 'researcher', password: 'a long test password' }).expect(403);
    await request(app).post('/auth/login').send({ username: 'researcher', password: 'wrong' }).expect(401);
    await request(app).post('/auth/login').send({ username: 'researcher', password: 'a long test password' }).expect(200);
    await accounts.disable(member.id, true);
    await request(app).get('/api/projects').set('Cookie', cookie).expect(401);
    expect((await accounts.owner())?.id).toBe(owner.id);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('serializes account creation across requests and store instances', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'patex-accounts-race-'));
  try {
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => new Accounts(root).create('same_name')));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await new Accounts(root).list()).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
