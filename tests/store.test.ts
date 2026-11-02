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
  test('persists scripts and generated artifacts for a project', async () => {
    const p = await store.create('Analysis');
    expect((await store.get(p.id)).scripts.r).toContain('png(');
    await store.updateScript(p.id, 'javascript', 'console.log(42)');
    await store.saveArtifacts(p.id, [{ name: 'answer.tex', base64: Buffer.from('42').toString('base64') }]);
    expect((await store.get(p.id)).scripts.javascript).toBe('console.log(42)');
    expect((await store.compileAssets(p.id))[0].name).toBe('answer.tex');
    await store.deleteArtifact(p.id, 'answer.tex');
    expect(await store.listArtifacts(p.id)).toHaveLength(0);
  });
  test('creates a literate document and preserves legacy TeX projects', async () => {
    const rmd = await store.create('Research', 'rmd');
    expect(rmd.format).toBe('rmd');
    expect(rmd.latex).toContain('```{r}');
    expect(rmd.latex).toContain('`r mean(values)`');
    const tex = await store.create('Legacy');
    expect(tex.format).toBe('tex');
    const file = path.join(root, tex.id, 'project.json');
    const { readFile, writeFile } = await import('node:fs/promises');
    const old = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    delete old.format;
    await writeFile(file, JSON.stringify(old));
    expect((await store.get(tex.id)).format).toBe('tex');
    expect((await store.get(tex.id)).feedbackEnabled).toBe(false);
    expect((await store.get(tex.id)).bibliography).toBe('');
  });
  test('stores a bibliography alongside the document', async () => {
    const project = await store.create('Citations', 'qmd');
    const bib = '@article{doe2025, title={Research}, author={Doe, Jane}, year={2025}}';
    await store.updateBibliography(project.id, bib);
    expect((await store.get(project.id)).bibliography).toBe(bib);
  });
  test('serializes simultaneous source and bibliography edits across store instances', async () => {
    const project = await store.create('Concurrent edits');
    const another = new ProjectStore(root);
    await Promise.all([store.update(project.id, { latex: 'new source' }), another.updateBibliography(project.id, '@book{key, title={New}}')]);
    expect((await store.get(project.id)).latex).toBe('new source');
    expect((await store.get(project.id)).bibliography).toContain('@book{key');
  });
  test('keeps AI feedback opt-in and exportable', async () => {
    const project = await store.create('Private paper');
    const input = { provider: 'llamafarm' as const, decision: 'accepted' as const, sourceBefore: 'old', suggestion: 'new', sourceAfter: 'new' };
    await expect(store.recordFeedback(project.id, input)).rejects.toThrow('Feedback capture is off');
    await store.setFeedbackEnabled(project.id, true);
    await store.recordFeedback(project.id, input);
    expect((await store.readFeedback(project.id))[0]).toMatchObject(input);
    await store.deleteFeedback(project.id);
    expect(await store.readFeedback(project.id)).toHaveLength(0);
  });
});
