import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, stat, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { defaultLatex, defaultQmd, defaultRmd } from '../shared/template.js';
import { defaultScripts } from '../shared/scripts.js';
import { scriptFiles } from '../shared/scripts.js';
import { artifactName } from '../shared/artifacts.js';
import { decodedFiles, formatForFile, mainFileFor, materializeFiles, projectLimits, projectPath } from '../shared/project-files.js';
import type { Artifact, ArtifactSummary, Diagnostic, DocumentFormat, FeedbackEvent, Project, ProjectFile, ProjectFileSummary, ProjectSummary, RevisionSummary, ScriptLanguage } from '../shared/types.js';

const validId = /^[0-9a-f-]{36}$/;
interface StoredRevision { id: string; at: string; project: Project; files: { name: string; hash: string }[]; fingerprint: string }
export interface StoredBuild { hash: string; log: string; diagnostics?: Diagnostic[]; synctexBase64?: string; sourceRoot?: string; runtime?: { image: string } }
const mutationLocks = new Map<string, Promise<unknown>>();
export class ProjectStore {
  constructor(private readonly root: string) {
    for (const method of ['create', 'importProject', 'update', 'updateBibliography', 'updateScript', 'setFeedbackEnabled', 'recordFeedback', 'deleteFeedback', 'saveFiles', 'removeFile', 'restore', 'saveArtifacts', 'deleteArtifact', 'checkpoint', 'buildInput', 'exportFiles'] as const) {
      const original = this[method] as unknown as (...args: unknown[]) => Promise<unknown>;
      Object.defineProperty(this, method, { value: (...args: unknown[]) => {
        const key = `${this.root}/${method === 'create' || method === 'importProject' ? '_create' : String(args[0])}`;
        const previous = mutationLocks.get(key) || Promise.resolve();
        const task = previous.catch(() => {}).then(() => original.apply(this, args));
        mutationLocks.set(key, task);
        return task.finally(() => { if (mutationLocks.get(key) === task) mutationLocks.delete(key); });
      } });
    }
  }
  get dataRoot(): string { return this.root; }
  workspace(id: string): ProjectStore { if (!validId.test(id)) throw new Error('Invalid workspace'); return new ProjectStore(path.join(this.root, '_workspaces', id)); }
  private projectDir(id: string): string {
    if (!validId.test(id)) throw new Error('Invalid project ID');
    return path.join(this.root, id);
  }
  async list(archived = false): Promise<ProjectSummary[]> {
    await mkdir(this.root, { recursive: true });
    const names = await readdir(this.root, { withFileTypes: true });
    const projects = await Promise.all(names.filter(e => e.isDirectory() && validId.test(e.name)).map(async e => {
      try { const project = await this.get(e.name); return { id: project.id, name: project.name, updatedAt: project.updatedAt, hasPdf: project.hasPdf, archived: project.archived === true }; }
      catch { return null; }
    }));
    return projects.filter((p): p is NonNullable<typeof p> => p !== null && p.archived === archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async create(name = 'Untitled Project', format: DocumentFormat = 'tex'): Promise<Project> {
    if ((await this.list()).length + (await this.list(true)).length >= 50) throw new Error('Workspace project limit reached (50)');
    const id = randomUUID();
    const dir = this.projectDir(id);
    await mkdir(dir, { recursive: true });
    const source = format === 'rmd' ? defaultRmd : format === 'qmd' ? defaultQmd : defaultLatex;
    const project: Project = { id, name: name.trim().slice(0, 100) || 'Untitled Project', latex: source, format, mainFile: mainFileFor(format), engine: 'pdflatex', bibliography: '', scripts: { ...defaultScripts }, feedbackEnabled: false, updatedAt: new Date().toISOString(), hasPdf: false };
    await this.put(project);
    return project;
  }
  async get(id: string): Promise<Project> {
    const obj = JSON.parse(await readFile(path.join(this.projectDir(id), 'project.json'), 'utf8')) as Project;
    const hasPdf = await stat(path.join(this.projectDir(id), 'document.pdf')).then(() => true, () => false);
    return { ...obj, format: obj.format || 'tex', mainFile: obj.mainFile || mainFileFor(obj.format || 'tex'), engine: obj.engine || 'pdflatex', bibliography: obj.bibliography || '', feedbackEnabled: obj.feedbackEnabled === true, scripts: { ...defaultScripts, ...obj.scripts }, hasPdf };
  }
  async update(id: string, input: { latex?: string; name?: string; archived?: boolean; engine?: Project['engine'] }): Promise<Project> {
    const current = await this.get(id);
    const changedLatex = input.latex !== undefined && current.latex !== input.latex;
    const updated: Project = {
      ...current,
      ...(input.archived === undefined ? {} : { archived: input.archived }),
      ...(input.engine === undefined ? {} : { engine: input.engine }),
      latex: input.latex ?? current.latex,
      name: input.name === undefined ? current.name : (input.name.trim().slice(0, 100) || current.name),
      updatedAt: new Date().toISOString(),
      hasPdf: changedLatex ? false : current.hasPdf,
    };
    if (changedLatex) {
      // A previously compiled PDF remains on disk as last-good preview, but UI marks source as out of date.
      updated.hasPdf = current.hasPdf;
    }
    await this.put(updated);
    return updated;
  }
  private async put(p: Project, snapshot = true): Promise<void> {
    const dir = this.projectDir(p.id);
    const filename = path.join(dir, 'project.json');
    const previous = await this.get(p.id).catch(() => null);
    if (snapshot && previous && JSON.stringify({ ...previous, updatedAt: '', hasPdf: false }) !== JSON.stringify({ ...p, updatedAt: '', hasPdf: false })) await this.snapshot(p.id, previous);
    const temp = path.join(dir, `.project-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(p, null, 2), { mode: 0o600 });
    await rename(temp, filename);
  }
  async savePdf(id: string, data: Buffer): Promise<void> {
    const dir = this.projectDir(id);
    const temp = path.join(dir, `.${randomUUID()}.pdf`);
    await writeFile(temp, data, { mode: 0o600 });
    await rename(temp, path.join(dir, 'document.pdf'));
  }
  async readPdf(id: string): Promise<Buffer> { return readFile(path.join(this.projectDir(id), 'document.pdf')); }
  async readBuild(id: string): Promise<StoredBuild | null> { return readFile(path.join(this.projectDir(id), 'build.json'), 'utf8').then(value => JSON.parse(value) as StoredBuild, () => null); }
  async writeBuild(id: string, value: StoredBuild): Promise<void> {
    const dir = this.projectDir(id); const temp = path.join(dir, `.build-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, path.join(dir, 'build.json'));
  }
  async readAnalysisCache(id: string): Promise<{ key: string; files: ProjectFile[] } | null> { return readFile(path.join(this.projectDir(id), 'analysis-cache.json'), 'utf8').then(text => JSON.parse(text) as { key: string; files: ProjectFile[] }, () => null); }
  async writeAnalysisCache(id: string, key: string, files: ProjectFile[]): Promise<void> {
    decodedFiles(files);
    if (JSON.stringify(files).length > 12 * 1024 * 1024) return;
    const dir = this.projectDir(id); const temp = path.join(dir, `.cache-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify({ key, files }), { mode: 0o600 }); await rename(temp, path.join(dir, 'analysis-cache.json'));
  }
  async importProject(name: string, mainFile: string, files: ProjectFile[], engine: Project['engine'] = 'pdflatex'): Promise<Project> {
    const decoded = decodedFiles(files);
    mainFile = projectPath(mainFile);
    const main = decoded.find(file => file.name === mainFile);
    if (!main || main.data.length > projectLimits.sourceBytes || main.data.includes(0) || !Buffer.from(main.data.toString('utf8')).equals(main.data)) throw new Error('Invalid or missing UTF-8 main document');
    if ((await this.list()).length + (await this.list(true)).length >= 50) throw new Error('Workspace project limit reached (50)');
    const id = randomUUID(); const stage = path.join(this.root, `.import-${id}`);
    const bibPath = path.posix.join(path.posix.dirname(mainFile), 'references.bib');
    const bibliography = decoded.find(file => file.name === bibPath)?.data.toString('utf8') || '';
    const imported: Project = { id, name: name.trim().slice(0, 100) || 'Imported project', mainFile, format: formatForFile(mainFile), engine, latex: main.data.toString('utf8'), bibliography, scripts: { ...defaultScripts }, feedbackEnabled: false, hasPdf: false, updatedAt: new Date().toISOString() };
    try {
      await mkdir(stage, { recursive: true, mode: 0o700 });
      await materializeFiles(path.join(stage, 'files'), files.filter(file => file.name !== mainFile && file.name !== bibPath));
      await writeFile(path.join(stage, 'project.json'), JSON.stringify(imported, null, 2), { mode: 0o600 });
      await rename(stage, this.projectDir(id)); return imported;
    } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  }
  private async diskFiles(id: string): Promise<ProjectFile[]> {
    const root = path.join(this.projectDir(id), 'files');
    const files: ProjectFile[] = [];
    const walk = async (dir: string, prefix: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), name + '/');
        else if (entry.isFile()) files.push({ name: projectPath(name), base64: (await readFile(path.join(dir, entry.name))).toString('base64') });
      }
    };
    await walk(root, '');
    return files;
  }
  async compileFiles(id: string): Promise<ProjectFile[]> {
    const project = await this.get(id);
    const files = await this.diskFiles(id);
    files.push({ name: project.mainFile, base64: Buffer.from(project.latex).toString('base64') });
    if (project.bibliography) files.push({ name: path.posix.join(path.posix.dirname(project.mainFile), 'references.bib'), base64: Buffer.from(project.bibliography).toString('base64') });
    for (const asset of await this.compileAssets(id)) {
      const name = `assets/${asset.name}`;
      if (!files.some(file => file.name.toLowerCase() === name.toLowerCase())) files.push({ ...asset, name });
    }
    decodedFiles(files);
    return files;
  }
  async buildInput(id: string): Promise<{ project: Project; files: ProjectFile[] }> { return { project: await this.get(id), files: await this.compileFiles(id) }; }
  async listFiles(id: string): Promise<ProjectFileSummary[]> {
    return (await this.compileFiles(id)).map(file => ({ name: file.name, size: Buffer.byteLength(file.base64, 'base64'), text: /\.(?:tex|latex|rmd|qmd|bib|r|py|js|ts|json|csv|tsv|txt|md|yml|yaml|cls|sty|bst|lock|Rprofile)$/i.test(file.name) || /(?:^|\/)\.here$/.test(file.name) }));
  }
  async readFile(id: string, name: string): Promise<Buffer> {
    projectPath(name);
    const file = (await this.compileFiles(id)).find(file => file.name === name);
    if (!file) throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
    return Buffer.from(file.base64, 'base64');
  }
  async saveFiles(id: string, files: ProjectFile[]): Promise<void> {
    const project = await this.get(id);
    const previous = await this.diskFiles(id);
    const merged = new Map(previous.map(file => [file.name, file]));
    for (const file of files) {
      if (file.name === project.mainFile || file.name === path.posix.join(path.posix.dirname(project.mainFile), 'references.bib')) throw new Error('Update the main document or bibliography through its editor');
      merged.set(file.name, file);
    }
    decodedFiles([...merged.values()]);
    await this.snapshot(id);
    await materializeFiles(path.join(this.projectDir(id), 'files'), files);
    await this.put({ ...project, updatedAt: new Date().toISOString() });
  }
  async removeFile(id: string, name: string): Promise<void> {
    projectPath(name);
    const project = await this.get(id);
    if (name === project.mainFile) throw new Error('Cannot remove the main document');
    await this.snapshot(id);
    await unlink(path.join(this.projectDir(id), 'files', ...name.split('/')));
    await this.put({ ...project, updatedAt: new Date().toISOString() });
  }
  async exportFiles(id: string): Promise<ProjectFile[]> {
    const project = await this.get(id);
    const files = await this.compileFiles(id);
    for (const language of ['javascript', 'python', 'r'] as const) if (!files.some(file => file.name === scriptFiles[language])) files.push({ name: scriptFiles[language], base64: Buffer.from(project.scripts[language]).toString('base64') });
    if (project.format === 'rmd' && !files.some(file => file.name === '.here')) files.push({ name: '.here', base64: '' });
    const manifest = { version: 1, name: project.name, mainFile: project.mainFile, format: project.format, engine: project.engine, runtime: (await this.readBuild(id))?.runtime, renderer: project.format === 'rmd' ? 'rmarkdown' : project.format === 'qmd' ? 'quarto' : 'latexmk', files: files.map(file => ({ name: file.name, sha256: createHash('sha256').update(Buffer.from(file.base64, 'base64')).digest('hex') })) };
    const build = `# Build ${project.name}\n\nMain source: ${project.mainFile}\n\nRun from this project root using the Patex compiler image, or install R Markdown/reticulate, Quarto, Node 22 and TeX Live as appropriate. Imported renv.lock, requirements.txt and package-lock.json files describe project dependencies; package installation is an explicit step before a build.\n\n` + (project.format === 'rmd' ? `Rscript -e 'rmarkdown::render(${JSON.stringify(project.mainFile)}, output_format="pdf_document")'\n` : project.format === 'qmd' ? `quarto render ${JSON.stringify(project.mainFile)} --to pdf\n` : `latexmk -${project.engine === "xelatex" ? "xelatex" : project.engine === "lualatex" ? "lualatex" : "pdf"} ${JSON.stringify(project.mainFile)}\n`);
    files.push({ name: 'patex-manifest.json', base64: Buffer.from(JSON.stringify(manifest, null, 2)).toString('base64') });
    if (!files.some(file => file.name === 'PATEX-BUILD.md')) files.push({ name: 'PATEX-BUILD.md', base64: Buffer.from(build).toString('base64') });
    return files;
  }
  async revisions(id: string): Promise<RevisionSummary[]> {
    await this.get(id);
    const dir = path.join(this.projectDir(id), 'history');
    const names = await readdir(dir).catch(() => []);
    const revisions = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(path.join(dir, name), 'utf8')) as StoredRevision));
    return revisions.sort((a, b) => b.at.localeCompare(a.at)).map(({ id: revisionId, at, project }) => ({ id: revisionId, at, name: project.name }));
  }
  async checkpoint(id: string): Promise<void> { await this.snapshot(id); }
  private async snapshot(id: string, value?: Project): Promise<void> {
    const project = value || await this.get(id);
    const dir = this.projectDir(id);
    const files = await this.diskFiles(id);
    for (const asset of await this.compileAssets(id)) if (!files.some(file => file.name === `assets/${asset.name}`)) files.push({ ...asset, name: `assets/${asset.name}` });
    const refs = files.map(file => ({ name: file.name, hash: createHash('sha256').update(Buffer.from(file.base64, 'base64')).digest('hex') }));
    const fingerprint = createHash('sha256').update(JSON.stringify({ project: { ...project, updatedAt: '', hasPdf: false }, files: refs })).digest('hex');
    const existing = await this.revisions(id);
    if (existing[0]) { const latest = JSON.parse(await readFile(path.join(dir, 'history', `${existing[0].id}.json`), 'utf8')) as StoredRevision; if (latest.fingerprint === fingerprint) return; }
    await mkdir(path.join(dir, 'history'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(dir, 'blobs'), { recursive: true, mode: 0o700 });
    for (let i = 0; i < files.length; i++) await writeFile(path.join(dir, 'blobs', refs[i].hash), Buffer.from(files[i].base64, 'base64'), { mode: 0o600, flag: 'wx' }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    const at = new Date(Math.max(Date.now(), ...existing.map(revision => Date.parse(revision.at) + 1))).toISOString();
    const record: StoredRevision = { id: randomUUID(), at, project, files: refs, fingerprint };
    await writeFile(path.join(dir, 'history', `${record.id}.json`), JSON.stringify(record), { mode: 0o600 });
    for (const old of existing.slice(39)) await unlink(path.join(dir, 'history', `${old.id}.json`));
    const retained = await this.revisions(id);
    const records = await Promise.all(retained.map(async revision => JSON.parse(await readFile(path.join(dir, 'history', `${revision.id}.json`), 'utf8')) as StoredRevision));
    let referenced = new Set(records.flatMap(record => record.files.map(file => file.hash)));
    let bytes = (await Promise.all([...referenced].map(hash => stat(path.join(dir, 'blobs', hash)).then(info => info.size)))).reduce((sum, size) => sum + size, 0);
    while (bytes > 128 * 1024 * 1024 && records.length > 1) {
      const oldest = records.pop()!; await unlink(path.join(dir, 'history', `${oldest.id}.json`));
      referenced = new Set(records.flatMap(record => record.files.map(file => file.hash)));
      bytes = (await Promise.all([...referenced].map(hash => stat(path.join(dir, 'blobs', hash)).then(info => info.size)))).reduce((sum, size) => sum + size, 0);
    }
    for (const blob of await readdir(path.join(dir, 'blobs'))) if (!referenced.has(blob)) await unlink(path.join(dir, 'blobs', blob));
  }
  async restore(id: string, revisionId: string): Promise<Project> {
    if (!validId.test(revisionId)) throw new Error('Invalid revision ID');
    const dir = this.projectDir(id);
    const revision = JSON.parse(await readFile(path.join(dir, 'history', `${revisionId}.json`), 'utf8')) as StoredRevision;
    const files = await Promise.all(revision.files.map(async file => ({ name: file.name, base64: (await readFile(path.join(dir, 'blobs', file.hash))).toString('base64') })));
    await this.snapshot(id);
    decodedFiles(files);
    await rm(path.join(dir, 'files'), { recursive: true, force: true });
    await rm(this.artifactDir(id), { recursive: true, force: true });
    await materializeFiles(path.join(dir, 'files'), files);
    const restored = { ...revision.project, id, archived: false, updatedAt: new Date().toISOString() };
    await this.put(restored, false);
    return this.get(id);
  }
  async updateBibliography(id: string, bibliography: string): Promise<Project> {
    const project = { ...await this.get(id), bibliography, updatedAt: new Date().toISOString() };
    await this.put(project);
    return project;
  }
  async setFeedbackEnabled(id: string, enabled: boolean): Promise<Project> {
    const project = { ...await this.get(id), feedbackEnabled: enabled, updatedAt: new Date().toISOString() };
    await this.put(project);
    return project;
  }
  async readFeedback(id: string): Promise<FeedbackEvent[]> {
    await this.get(id);
    const file = path.join(this.projectDir(id), 'feedback.json');
    return readFile(file, 'utf8').then(text => JSON.parse(text) as FeedbackEvent[], error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
  }
  async recordFeedback(id: string, input: Omit<FeedbackEvent, 'id' | 'at'>): Promise<FeedbackEvent> {
    const project = await this.get(id);
    if (!project.feedbackEnabled) throw new Error('Feedback capture is off');
    const events = await this.readFeedback(id);
    const event: FeedbackEvent = { ...input, id: randomUUID(), at: new Date().toISOString() };
    const updated = [...events, event].slice(-50);
    if (Buffer.byteLength(JSON.stringify(updated), 'utf8') > 2_000_000) throw new Error('Feedback storage limit exceeded');
    const dir = this.projectDir(id);
    const temp = path.join(dir, `.feedback-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(updated), { mode: 0o600 });
    await rename(temp, path.join(dir, 'feedback.json'));
    return event;
  }
  async deleteFeedback(id: string): Promise<void> {
    await this.get(id);
    await unlink(path.join(this.projectDir(id), 'feedback.json')).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
  async updateScript(id: string, language: ScriptLanguage, source: string): Promise<Project> {
    const current = await this.get(id);
    const updated = { ...current, scripts: { ...current.scripts, [language]: source }, updatedAt: new Date().toISOString() };
    await this.put(updated);
    return updated;
  }
  private artifactDir(id: string): string { return path.join(this.projectDir(id), 'assets'); }
  async listArtifacts(id: string): Promise<ArtifactSummary[]> {
    await this.get(id);
    const dir = this.artifactDir(id);
    const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    return Promise.all(entries.filter(e => e.isFile() && artifactName.test(e.name)).map(async e => ({
      name: e.name, size: (await stat(path.join(dir, e.name))).size,
    })));
  }
  async readArtifact(id: string, name: string): Promise<Buffer> {
    if (!artifactName.test(name)) throw new Error('Invalid artifact name');
    await this.get(id);
    return readFile(path.join(this.artifactDir(id), name));
  }
  async compileAssets(id: string): Promise<Artifact[]> {
    const files = await this.listArtifacts(id);
    return Promise.all(files.map(async file => ({ name: file.name, base64: (await this.readArtifact(id, file.name)).toString('base64') })));
  }
  async saveArtifacts(id: string, artifacts: Artifact[]): Promise<void> {
    await this.get(id);
    const dir = this.artifactDir(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const projected = new Map((await this.listArtifacts(id)).map(file => [file.name, file.size]));
    for (const artifact of artifacts) {
      if (!artifactName.test(artifact.name)) throw new Error('Invalid artifact name');
      const bytes = Buffer.from(artifact.base64, 'base64');
      if (bytes.length > 512 * 1024) throw new Error('Artifact exceeds 512 KB');
      projected.set(artifact.name, bytes.length);
    }
    if (projected.size > 12 || [...projected.values()].reduce((sum, size) => sum + size, 0) > 2 * 1024 * 1024) throw new Error('Project artifact limit exceeded');
    for (const artifact of artifacts) {
      const bytes = Buffer.from(artifact.base64, 'base64');
      const temp = path.join(dir, `.${randomUUID()}.tmp`);
      await writeFile(temp, bytes, { mode: 0o600 });
      await rename(temp, path.join(dir, artifact.name));
    }
  }
  async deleteArtifact(id: string, name: string): Promise<void> {
    if (!artifactName.test(name)) throw new Error('Invalid artifact name');
    await this.get(id);
    await unlink(path.join(this.artifactDir(id), name));
  }
}
