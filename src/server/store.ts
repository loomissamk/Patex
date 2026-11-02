import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { defaultLatex } from '../shared/template.js';
import type { Project, ProjectSummary } from '../shared/types.js';

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
    const project: Project = { id, name: name.trim().slice(0, 100) || 'Untitled Project', latex: defaultLatex, updatedAt: new Date().toISOString(), hasPdf: false };
    await this.put(project);
    return project;
  }
  async get(id: string): Promise<Project> {
    const obj = JSON.parse(await readFile(path.join(this.projectDir(id), 'project.json'), 'utf8')) as Project;
    const hasPdf = await stat(path.join(this.projectDir(id), 'document.pdf')).then(() => true, () => false);
    return { ...obj, hasPdf };
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
}
