import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectStore } from '../src/server/store.js';
describe('ProjectStore', () => {
  let root: string;
  let store: ProjectStore;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'patex-test-')); store = new ProjectStore(root); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  test('creates, updates and lists persistent projects', async () => {
    const p = await store.create('Homework');
    expect(p.latex).toContain('\\documentclass');
    expect((await store.list())[0].name).toBe('Homework');
    await store.update(p.id, { latex: 'hello' });
    expect((await store.get(p.id)).latex).toBe('hello');
  });
  test('rejects path traversal', async () => {
    await expect(store.get('../../etc/passwd')).rejects.toThrow('Invalid project ID');
  });
  test('persists compiled PDF', async () => {
    const p = await store.create('Document');
    await store.savePdf(p.id, Buffer.from('%PDF-test'));
    expect((await store.readPdf(p.id)).toString()).toBe('%PDF-test');
    expect((await store.get(p.id)).hasPdf).toBe(true);
  });
});
