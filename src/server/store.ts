import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { defaultLatex } from '../shared/template.js';
import { defaultScripts } from '../shared/scripts.js';
import { artifactName } from '../shared/artifacts.js';
import type { Artifact, ArtifactSummary, Project, ProjectSummary, ScriptLanguage } from '../shared/types.js';

const validId = /^[0-9a-f-]{36}$/;
export class ProjectStore {
  constructor(private readonly root: string) {}
  private projectDir(id: string): string {
    if (!validId.test(id)) throw new Error('Invalid project ID');
    return path.join(this.root, id);
  }
  async list(): Promise<ProjectSummary[]> {
    await mkdir(this.root, { recursive: true });
    const names = await readdir(this.root, { withFileTypes: true });
    const projects = await Promise.all(names.filter(e => e.isDirectory() && validId.test(e.name)).map(async e => {
      try { const project = await this.get(e.name); return { id: project.id, name: project.name, updatedAt: project.updatedAt, hasPdf: project.hasPdf }; }
      catch { return null; }
    }));
    return projects.filter((p): p is ProjectSummary => p !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async create(name = 'Untitled Project'): Promise<Project> {
    const id = randomUUID();
    const dir = this.projectDir(id);
    await mkdir(dir, { recursive: true });
    const project: Project = { id, name: name.trim().slice(0, 100) || 'Untitled Project', latex: defaultLatex, scripts: { ...defaultScripts }, updatedAt: new Date().toISOString(), hasPdf: false };
    await this.put(project);
    return project;
  }
  async get(id: string): Promise<Project> {
    const obj = JSON.parse(await readFile(path.join(this.projectDir(id), 'project.json'), 'utf8')) as Project;
    const hasPdf = await stat(path.join(this.projectDir(id), 'document.pdf')).then(() => true, () => false);
    return { ...obj, scripts: { ...defaultScripts, ...obj.scripts }, hasPdf };
  }
  async update(id: string, input: { latex?: string; name?: string }): Promise<Project> {
    const current = await this.get(id);
    const changedLatex = input.latex !== undefined && current.latex !== input.latex;
    const updated: Project = {
      ...current,
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
  private async put(p: Project): Promise<void> {
    const dir = this.projectDir(p.id);
    const filename = path.join(dir, 'project.json');
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
