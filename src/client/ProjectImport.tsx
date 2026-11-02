import { useRef, useState } from 'react';
import { zip } from 'fflate';
import type { Project } from '../shared/types';
type Api = (url: string, init?: RequestInit) => Promise<Response>;
export default function ProjectImport({ api, onImported, onClose }: { api: Api; onImported: (project: Project) => Promise<void>; onClose: () => void }) {
  const [archive, setArchive] = useState<Blob | null>(null);
  const [name, setName] = useState('Imported project');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [main, setMain] = useState('');
  const [message, setMessage] = useState('Choose a ZIP or project folder containing your source and supporting files.');
  const [busy, setBusy] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null); const folderInput = useRef<HTMLInputElement | null>(null);
  const inspect = async (blob: Blob, label: string) => {
    if (blob.size > 32 * 1024 * 1024) throw new Error('Compressed project exceeds 32 MB');
    const response = await api('/api/projects/import/inspect', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: blob });
    const result = await response.json() as { candidates: string[]; mainFile?: string; count: number; ignored: string[] };
    setArchive(blob); setCandidates(result.candidates); setMain(result.mainFile || ''); setName(label.replace(/\.zip$/i, ''));
    setMessage(`${result.count} files ready. ${result.ignored.length ? `${result.ignored.length} dependency/cache metadata files skipped.` : ''} Select the document to build.`);
  };
  const selected = async (files: FileList | null, folder = false) => {
    if (!files?.length) return; setBusy(true);
    try {
      if (!folder) await inspect(files[0], files[0].name);
      else {
        const entries: Record<string, Uint8Array> = {}; let total = 0; let count = 0;
        for (const file of Array.from(files)) {
          const path = file.webkitRelativePath || file.name;
          if (/(?:^|\/)(?:\.git|node_modules|\.venv|__MACOSX|\.DS_Store)(?:\/|$)|renv\/library\//i.test(path)) continue;
          total += file.size;
          if (++count > 500 || file.size > 8 * 1024 * 1024 || total > 64 * 1024 * 1024) throw new Error('Choose a project under 500 files / 64 MB, with each file under 8 MB');
          entries[path] = new Uint8Array(await file.arrayBuffer());
        }
        const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(entries, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)));
        await inspect(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }), files[0].webkitRelativePath.split('/')[0] || 'Imported project');
      }
    } catch (error) { setMessage((error as Error).message); setArchive(null); }
    finally { setBusy(false); }
  };
  const importProject = async () => {
    if (!archive || !main) return; setBusy(true);
    try { const response = await api(`/api/projects/import?main=${encodeURIComponent(main)}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: archive }); await onImported(await response.json() as Project); onClose(); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  return <div className="dialog-backdrop"><section className="project-dialog" aria-label="Import project"><div className="dialog-heading"><h2>Open an existing project</h2><button onClick={onClose} aria-label="Close import">×</button></div><p>{message}</p><div className="dialog-actions"><button className="light" disabled={busy} onClick={() => zipInput.current?.click()}>Choose ZIP</button><button className="light" disabled={busy} onClick={() => folderInput.current?.click()}>Choose folder</button></div><input hidden ref={zipInput} type="file" accept=".zip" onChange={event => void selected(event.target.files)}/><input hidden multiple ref={element => { folderInput.current = element; element?.setAttribute('webkitdirectory', ''); }} type="file" onChange={event => void selected(event.target.files, true)}/>{archive && <><label>Project name<input value={name} onChange={event => setName(event.target.value)}/></label><label>Main document<select value={main} onChange={event => setMain(event.target.value)}><option value="">Choose the document to build</option>{candidates.map(file => <option key={file}>{file}</option>)}</select></label></>}<button className="primary" disabled={busy || !archive || !main} onClick={() => void importProject()}>{busy ? 'Working…' : 'Open project'}</button></section></div>;
}
