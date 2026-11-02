import yauzl from 'yauzl';
import { ZipFile } from 'yazl';
import { decodedFiles, formatForFile, projectLimits, projectPath } from '../shared/project-files.js';
import type { ProjectFile } from '../shared/types.js';

const ignoredPath = /(?:^|\/)(?:\.git|node_modules|\.venv|__MACOSX|\.DS_Store)(?:\/|$)|(?:^|\/)renv\/library\//i;
export async function readArchive(data: Buffer): Promise<{ files: ProjectFile[]; candidates: string[]; mainFile?: string; ignored: string[] }> {
  const files: ProjectFile[] = [];
  const ignored: string[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('Invalid ZIP archive')); return; }
      let entries = 0;
      const fail = (reason: unknown) => { zip.close(); reject(reason instanceof Error ? reason : new Error('Invalid ZIP archive')); };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          if (++entries > 5000) throw new Error('Archive has too many entries');
          const name = entry.fileName;
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('Archive symlinks are not supported');
          projectPath(name.replace(/\/$/, ''));
          if (name.endsWith('/') || ignoredPath.test(name)) { if (!name.endsWith('/')) ignored.push(name); zip.readEntry(); return; }
          total += entry.uncompressedSize;
          if (files.length >= projectLimits.files || entry.uncompressedSize > projectLimits.fileBytes || total > projectLimits.totalBytes) throw new Error('Project archive size limit exceeded');
          const bytes = await new Promise<Buffer>((done, bad) => zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) { bad(streamError || new Error('Invalid ZIP entry')); return; }
            const chunks: Buffer[] = []; let size = 0;
            stream.on('data', (chunk: Buffer) => { size += chunk.length; if (size > entry.uncompressedSize || size > projectLimits.fileBytes) stream.destroy(new Error('ZIP entry size limit exceeded')); else chunks.push(chunk); });
            stream.on('error', bad); stream.on('end', () => done(Buffer.concat(chunks)));
          }));
          files.push({ name, base64: bytes.toString('base64') });
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
  const first = files[0]?.name.split('/')[0];
  if (first && files.every(f => f.name.startsWith(`${first}/`))) for (const file of files) file.name = file.name.slice(first.length + 1);
  decodedFiles(files);
  let mainFile: string | undefined;
  const manifest = files.find(f => f.name === 'patex-manifest.json');
  if (manifest) {
    try { const value = JSON.parse(Buffer.from(manifest.base64, 'base64').toString()) as { mainFile?: string }; if (value.mainFile) mainFile = projectPath(value.mainFile); }
    catch { throw new Error('Invalid Patex project manifest'); }
  }
  const candidates = files.filter(f => /\.(tex|latex|rmd|qmd)$/i.test(f.name)).map(f => f.name).sort();
  if (mainFile && !candidates.includes(mainFile)) throw new Error('Manifest main document is missing');
  mainFile ||= candidates.length === 1 ? candidates[0] : undefined;
  if (mainFile) formatForFile(mainFile);
  return { files: files.filter(f => f.name !== 'patex-manifest.json'), candidates, mainFile, ignored };
}
export async function writeArchive(files: ProjectFile[]): Promise<Buffer> {
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.on('error', reject); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); });
  for (const file of decodedFiles(files).sort((a, b) => a.name.localeCompare(b.name))) zip.addBuffer(file.data, file.name, { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100644 });
  zip.end();
  return result;
}
