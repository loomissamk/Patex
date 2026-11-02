import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readArchive, writeArchive } from '../src/server/archive.js';
import { decodedFiles, projectPath } from '../src/shared/project-files.js';
import { ProjectStore } from '../src/server/store.js';
import { ZipFile } from 'yazl';
const file = (name: string, text: string) => ({ name, base64: Buffer.from(text).toString('base64') });
test('rejects traversal, absolute, Windows and case-colliding paths', () => {
  for (const name of ['../escape', '/etc/passwd', 'R/../../escape', 'C:/test', 'R\\utils.R', 'folder/CON.txt', 'a//b', '.patex-output.pdf']) expect(() => projectPath(name)).toThrow();
  expect(() => decodedFiles([file('R/utils.R', 'a'), file('r/UTILS.R', 'b')])).toThrow('Duplicate');
  expect(() => decodedFiles([file('R', 'a'), file('R/utils.R', 'b')])).toThrow('conflicts');
  expect(projectPath('.here')).toBe('.here');
});
test('rejects compressed oversized entries and symlinks before importing them', async () => {
  const archive = async (symlink: boolean) => {
    const zip = new ZipFile(); const chunks: Buffer[] = [];
    const result = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
    zip.addBuffer(symlink ? Buffer.from('/etc/passwd') : Buffer.alloc(9 * 1024 * 1024), symlink ? 'link' : 'huge.csv', { mode: symlink ? 0o120777 : 0o100644 }); zip.end(); return result;
  };
  await expect(readArchive(await archive(true))).rejects.toThrow('symlinks');
  await expect(readArchive(await archive(false))).rejects.toThrow('size limit');
});
test('round trips a nested project without changing source or support bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'patex-bundle-'));
  try {
    const store = new ProjectStore(root);
    const source = '---\noutput: pdf_document\n---\n```{r}\nsource(here::here("R", "utils.R"))\n```';
    const input = [file('homework/paper.Rmd', source), file('R/utils.R', 'answer <- 42'), file('data/table.csv', 'x,y\n1,2'), file('.here', '')];
    const archive = await readArchive(await writeArchive(input));
    const project = await store.importProject('Research', 'homework/paper.Rmd', archive.files);
    expect(project.latex).toBe(source);
    expect((await store.readFile(project.id, 'R/utils.R')).toString()).toBe('answer <- 42');
    const exported = await readArchive(await writeArchive(await store.exportFiles(project.id)));
    expect(exported.mainFile).toBe('homework/paper.Rmd');
    const imported = await store.importProject('Rebuilt', exported.mainFile!, exported.files);
    expect(imported.latex).toBe(source);
    expect((await store.readFile(imported.id, 'data/table.csv')).toString()).toBe('x,y\n1,2');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('history restores source and helper together, and archive is reversible', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'patex-history-'));
  try {
    const store = new ProjectStore(root);
    const p = await store.importProject('Paper', 'main.tex', [file('main.tex', 'original'), file('R/helper.R', 'old')]);
    await store.checkpoint(p.id);
    const revision = (await store.revisions(p.id))[0];
    await store.update(p.id, { latex: 'changed' });
    await store.saveFiles(p.id, [file('R/helper.R', 'new')]);
    await store.restore(p.id, revision.id);
    expect((await store.get(p.id)).latex).toBe('original');
    expect((await store.readFile(p.id, 'R/helper.R')).toString()).toBe('old');
    await store.update(p.id, { archived: true });
    expect(await store.list()).toHaveLength(0);
    expect(await store.list(true)).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
