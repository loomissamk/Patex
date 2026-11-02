import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Bot, Check, Code2, Download, FilePlus, FileText, KeyRound, LoaderCircle, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, PanelRightClose, Play, Settings2, Sparkles, Terminal, Upload, X } from 'lucide-react';
import SourceEditor from './SourceEditor';
import { defaultScripts, scriptFiles } from '../shared/scripts';
import type { ArtifactSummary, ProjectScripts, ScriptLanguage } from '../shared/types';

type ProjectSummary = { id: string; name: string; updatedAt: string; hasPdf: boolean };
type Project = ProjectSummary & { latex: string; scripts: ProjectScripts };
type Provider = 'llamafarm' | 'anthropic' | 'openai';
type AiReply = { text: string; suggestedLatex: string | null };
type Integrations = Record<Provider, { configured: boolean; model: string }> & { mcp: { configured: boolean } };

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('patex-token') || '');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [latex, setLatex] = useState('');
  const [scripts, setScripts] = useState<ProjectScripts>({ ...defaultScripts });
  const [activeFile, setActiveFile] = useState<'latex' | ScriptLanguage>('latex');
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const [outputTitle, setOutputTitle] = useState('COMPILE OUTPUT');
  const [projectName, setProjectName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const activeProjectRef = useRef('');
  const [diagnostics, setDiagnostics] = useState('');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [inlineAiStatus, setInlineAiStatus] = useState<'waiting' | 'ready' | 'unavailable'>('ready');
  const [editorWidth, setEditorWidth] = useState(() => {
    const stored = Number(localStorage.getItem('patex-editor-width'));
    return stored >= 25 && stored <= 75 ? stored : 50;
  });
  const [resizing, setResizing] = useState(false);
  const [provider, setProvider] = useState<Provider>('llamafarm');
  const [prompt, setPrompt] = useState('');
  const [aiReply, setAiReply] = useState<AiReply | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [creating, setCreating] = useState(false);
  const revision = useRef(0);
  const compilingRef = useRef(false);
  const latestEditRef = useRef({ id: '', source: '', name: '' });
  const pendingScriptRef = useRef<{ id: string; language: ScriptLanguage; source: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const loadedTokenRef = useRef<string | null>(null);
  const projectId = project?.id;

  useEffect(() => { sessionStorage.setItem('patex-token', token); }, [token]);
  useEffect(() => { localStorage.setItem('patex-editor-width', String(editorWidth)); }, [editorWidth]);
  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response;
  }, [token]);
  const requestCompletion = useCallback(async (prefix: string, suffix: string, signal: AbortSignal) => {
    const response = await api('/api/complete', { method: 'POST', signal, body: JSON.stringify({ provider, prefix, suffix }) });
    const result = await response.json() as { text: string };
    return result.text;
  }, [api, provider]);
  useEffect(() => {
    if (!connectionsOpen) return;
    void api('/api/integrations').then(async response => setIntegrations(await response.json() as Integrations)).catch(e => setStatus((e as Error).message));
  }, [api, connectionsOpen]);
  const listProjects = useCallback(async () => {
    const result = await api('/api/projects');
    const entries = await result.json() as ProjectSummary[];
    setProjects(entries);
    return entries;
  }, [api]);
  const refreshPdf = useCallback(async (id: string) => {
    try {
      const res = await api(`/api/projects/${id}/pdf`);
      const pdf = await res.blob();
      if (activeProjectRef.current !== id) return;
      const blobUrl = URL.createObjectURL(pdf);
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = blobUrl;
      setPdfUrl(blobUrl);
    } catch {
      if (activeProjectRef.current !== id) return;
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
      setPdfUrl(null);
    }
  }, [api]);
  useEffect(() => () => { if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current); }, []);
  const openProject = useCallback(async (id: string) => {
    try {
      if (dirty && project) {
        await api(`/api/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ latex, name: projectName }) });
      }
      const pending = pendingScriptRef.current;
      if (pending) {
        await api(`/api/projects/${pending.id}/scripts/${pending.language}`, { method: 'PUT', body: JSON.stringify({ source: pending.source }) });
        if (pendingScriptRef.current === pending) pendingScriptRef.current = null;
      }
      const res = await api(`/api/projects/${id}`);
      const next = await res.json() as Project;
      revision.current++;
      latestEditRef.current = { id: next.id, source: next.latex, name: next.name };
      activeProjectRef.current = next.id;
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
      setPdfUrl(null);
      setProject(next);
      setProjectName(next.name);
      setLatex(next.latex);
      setScripts(next.scripts || { ...defaultScripts });
      setActiveFile('latex');
      setArtifacts([]);
      setDirty(false);
      setDiagnostics('');
      setAiReply(null);
      setInlineAiStatus('ready');
      setStatus('Ready');
      sessionStorage.setItem('patex-last-project', next.id);
      void refreshPdf(next.id);
      void api(`/api/projects/${next.id}/artifacts`).then(async response => {
        if (activeProjectRef.current === next.id) setArtifacts(await response.json() as ArtifactSummary[]);
      }).catch(() => {});
    } catch (e) { setStatus((e as Error).message); }
  }, [api, refreshPdf, dirty, project, latex, projectName]);
  useEffect(() => {
    if (loadedTokenRef.current === token) return;
    loadedTokenRef.current = token;
    void listProjects().then(entries => {
      const previous = sessionStorage.getItem('patex-last-project');
      const selected = entries.find(p => p.id === previous) || entries[0];
      if (selected) return openProject(selected.id);
    }).catch(e => setStatus((e as Error).message));
  }, [token, listProjects, openProject]);
  const createProject = async () => {
    if (creating) return;
    const name = window.prompt('New LaTeX project name', 'Untitled Project');
    if (name === null) return;
    setCreating(true);
    setStatus('Creating project…');
    try {
      const res = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
      const next = await res.json() as Project;
      await listProjects();
      await openProject(next.id);
    } catch (e) { setStatus((e as Error).message); }
    finally { setCreating(false); }
  };
  const save = useCallback(async (id: string, source: string, name: string, editRevision: number) => {
    const res = await api(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify({ latex: source, name }) });
    const saved = await res.json() as Project;
    if (revision.current === editRevision) { setDirty(false); setStatus('Saved'); setProject(saved); }
    return saved;
  }, [api]);
  const saveScript = useCallback(async (id: string, language: ScriptLanguage, source: string) => {
    await api(`/api/projects/${id}/scripts/${language}`, { method: 'PUT', body: JSON.stringify({ source }) });
    const pending = pendingScriptRef.current;
    if (pending?.id === id && pending.language === language && pending.source === source) pendingScriptRef.current = null;
    setStatus('Saved');
  }, [api]);
  useEffect(() => {
    const pending = pendingScriptRef.current;
    if (!pending || pending.id !== projectId) return;
    const timer = window.setTimeout(() => {
      void saveScript(pending.id, pending.language, pending.source).catch(e => setStatus(`Save failed: ${(e as Error).message}`));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [scripts, projectId, saveScript]);
  useEffect(() => {
    if (!dirty || !projectId) return;
    const id = projectId;
    const editRevision = revision.current;
    const timer = window.setTimeout(() => {
      void save(id, latex, projectName, editRevision).catch(e => setStatus(`Save failed: ${(e as Error).message}`));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [dirty, latex, projectName, projectId, save]);
  const compile = useCallback(async (id: string, source: string, name: string, rev: number) => {
    if (compilingRef.current) return;
    compilingRef.current = true;
    setCompiling(true);
    setStatus('Compiling…');
    setOutputTitle('COMPILE OUTPUT');
    try {
      await save(id, source, name, rev);
      const res = await api(`/api/projects/${id}/compile`, { method: 'POST' });
      const result = await res.json() as { ok: boolean; log: string };
      if (revision.current === rev) {
        setDiagnostics(result.log);
        setShowDiagnostics(!result.ok);
        setStatus(result.ok ? 'Compiled successfully' : 'LaTeX errors — see log');
        if (result.ok) await refreshPdf(id);
      }
    } catch (e) {
      if (revision.current === rev) { setStatus(`Compile failed: ${(e as Error).message}`); setDiagnostics((e as Error).message); setShowDiagnostics(true); }
    } finally {
      compilingRef.current = false;
      setCompiling(false);
      // Edits made during an in-flight build must get their own build.
      const latest = latestEditRef.current;
      if (revision.current !== rev && latest.id === id) {
        queueMicrotask(() => void compile(latest.id, latest.source, latest.name, revision.current));
      }
    }
  }, [save, api, refreshPdf]);
  // Autosave changes `dirty`; this timer deliberately depends on source, not dirty.
  useEffect(() => {
    if (!projectId) return;
    const timer = window.setTimeout(() => { void compile(projectId, latex, projectName, revision.current); }, 2400);
    return () => window.clearTimeout(timer);
  }, [latex, projectName, projectId, compile]);
  const edit = (text: string) => { setLatex(text); revision.current++; latestEditRef.current = { id: projectId || '', source: text, name: projectName }; setDirty(true); setStatus('Editing…'); };
  const rename = (text: string) => { setProjectName(text); revision.current++; latestEditRef.current = { id: projectId || '', source: latex, name: text }; setDirty(true); };
  const editScript = (language: ScriptLanguage, source: string) => {
    setScripts(current => ({ ...current, [language]: source }));
    pendingScriptRef.current = { id: projectId || '', language, source };
    setStatus('Editing…');
  };
  const selectFile = async (file: 'latex' | ScriptLanguage) => {
    const pending = pendingScriptRef.current;
    try {
      if (pending) await saveScript(pending.id, pending.language, pending.source);
      setActiveFile(file);
      setShowDiagnostics(false);
    } catch (e) { setStatus(`Save failed: ${(e as Error).message}`); }
  };
  const runScript = async (language: ScriptLanguage) => {
    if (!project || runBusy) return;
    setRunBusy(true);
    setStatus(`Running ${scriptFiles[language]}…`);
    setOutputTitle(`${scriptFiles[language]} OUTPUT`);
    try {
      const source = scripts[language];
      const response = await api(`/api/projects/${project.id}/run/${language}`, { method: 'POST', body: JSON.stringify({ source }) });
      const result = await response.json() as { ok: boolean; exitCode: number | null; stdout: string; stderr: string; artifacts: ArtifactSummary[] };
      if (pendingScriptRef.current?.id === project.id && pendingScriptRef.current.language === language && pendingScriptRef.current.source === source) pendingScriptRef.current = null;
      setDiagnostics([result.stdout, result.stderr].filter(Boolean).join('\n') || (result.ok ? 'Finished with no console output.' : `Exited with code ${result.exitCode}.`));
      setShowDiagnostics(true);
      setArtifacts(result.artifacts);
      setStatus(result.ok ? `${scriptFiles[language]} finished` : `${scriptFiles[language]} failed`);
      if (result.ok && result.artifacts.length) void compile(project.id, latex, projectName, revision.current);
    } catch (e) { setDiagnostics((e as Error).message); setShowDiagnostics(true); setStatus(`Run failed: ${(e as Error).message}`); }
    finally { setRunBusy(false); }
  };
  const insertArtifact = (name: string) => {
    const image = /\.(?:png|jpe?g|pdf)$/i.test(name);
    if (!image && !/\.tex$/i.test(name)) return;
    const command = image ? `\\includegraphics[width=0.8\\linewidth]{assets/${name}}` : `\\input{assets/${name}}`;
    let source = latex;
    if (image && !/\\usepackage(?:\[[^\]]*\])?\{graphicx\}/.test(source)) source = source.replace(/(\\documentclass[^\n]*\n)/, '$1\\usepackage{graphicx}\n');
    source = source.includes('\\end{document}') ? source.replace('\\end{document}', `${command}\n\\end{document}`) : `${source}\n${command}\n`;
    edit(source);
    void selectFile('latex');
  };
  const downloadArtifact = async (name: string) => {
    if (!project) return;
    try {
      const response = await api(`/api/projects/${project.id}/artifacts/${encodeURIComponent(name)}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setStatus((e as Error).message); }
  };
  const deleteArtifact = async (name: string) => {
    if (!project || !window.confirm(`Delete generated file ${name}?`)) return;
    try {
      await api(`/api/projects/${project.id}/artifacts/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setArtifacts(current => current.filter(file => file.name !== name));
      setStatus(`${name} deleted`);
    } catch (e) { setStatus((e as Error).message); }
  };
  const downloadText = () => {
    if (!project) return;
    const blob = new Blob([latex], { type: 'text/x-tex' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${projectName.replace(/[^a-z0-9-_]/gi, '_') || 'document'}.tex`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadPdf = async () => {
    if (!project) return;
    try {
      const res = await api(`/api/projects/${project.id}/pdf`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = `${projectName.replace(/[^a-z0-9-_]/gi, '_') || 'document'}.pdf`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setStatus((e as Error).message); }
  };
  const copyMcpEndpoint = async () => {
    const endpoint = `${window.location.origin}/mcp`;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(endpoint);
    } catch {
      const input = document.createElement('textarea');
      input.value = endpoint;
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setStatus('MCP endpoint copied');
  };
  const askAssistant = async () => {
    if (!project || !prompt.trim()) return;
    setAiBusy(true);
    setAiReply(null);
    try {
      const res = await api('/api/assist', { method: 'POST', body: JSON.stringify({ provider, projectId: project.id, prompt }) });
      setAiReply(await res.json() as AiReply);
    } catch (e) { setAiReply({ text: (e as Error).message, suggestedLatex: null }); }
    finally { setAiBusy(false); }
  };
  const uploadTex = async (file: File) => {
    if (!project) return;
    if (file.size > 200_000) { setStatus('Source is too large'); return; }
    edit(await file.text());
  };
  return <div className={`shell${focusMode ? ' focus-mode' : ''}${sidebarOpen ? ' sidebar-open' : ''}`}>
    <header className="topbar">
      <button className="light project-panel-toggle" aria-label={sidebarOpen ? 'Hide project sidebar' : 'Show project sidebar'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(x => !x)}>{sidebarOpen ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}<span>Projects</span></button>
      <div className="logo"><span className="brand-symbol">P</span><div><strong>Patex</strong><small>SL Labs / LaTeX Studio</small></div></div>
      <div className="project-heading">{project ? <><FileText size={16}/><input aria-label="Project name" value={projectName} onChange={e => rename(e.target.value)} /></> : <span>Select a project</span>}</div>
      <div className="actions">
        <span className={`status ${status.includes('failed') || status.includes('errors') ? 'bad' : ''}`}>{compiling && <LoaderCircle className="spin" size={14}/>} {status}</span>
        <button className="light" onClick={() => void createProject()} disabled={creating} title="New project"><FilePlus size={16}/> New</button>
        <button className="primary" onClick={() => project && void compile(project.id, latex, projectName, revision.current)} disabled={!project || compiling}><Play size={15} fill="currentColor"/> Compile</button>
        <button className="light focus-toggle" aria-label={focusMode ? 'Exit 50/50 focus mode' : 'Enter 50/50 focus mode'} aria-pressed={focusMode} onClick={() => { setFocusMode(x => !x); setSidebarOpen(focusMode); }} >{focusMode ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}<span>{focusMode ? 'Exit focus' : '50/50 focus'}</span></button>
        <button className="icon-button" title="Writing assistant" aria-label="Writing assistant" onClick={() => { setAiOpen(x => !x); setConnectionsOpen(false); }}><Sparkles size={19}/></button>
        <button className="icon-button" title="Connections" aria-label="Connections" onClick={() => { setConnectionsOpen(x => !x); setAiOpen(false); }}><Settings2 size={19}/></button>
      </div>
    </header>
    <div className={`workbench${resizing ? ' resizing' : ''}`} ref={workbenchRef} style={{ '--editor-width': `${editorWidth}%` } as CSSProperties}>
      <aside className="sidebar">
        <div className="sidebar-heading"><strong>WORKSPACE</strong><button className="icon-button" title="New project" disabled={creating} onClick={() => void createProject()}><FilePlus size={18}/></button></div>
        <button className="new-project" disabled={creating} onClick={() => void createProject()}><FilePlus size={16}/> New project</button>
        <div className="nav-header"><BookOpen size={13}/> PROJECTS</div>
        {projects.map(p => <button key={p.id} className={`project-item ${p.id === project?.id ? 'selected' : ''}`} onClick={() => { void openProject(p.id); if (focusMode) setSidebarOpen(false); }}><FileText size={16}/><span>{p.name}</span></button>)}
        {projects.length === 0 && <p className="empty-sidebar">Create a project to begin writing.</p>}
      </aside>
      <main className="editor-workspace">
        <div className="pane-head file-head"><div className="file-tabs" role="tablist" aria-label="Project files">{(['latex', 'javascript', 'python', 'r'] as const).map(file => <button key={file} role="tab" aria-selected={activeFile === file} className={activeFile === file ? 'file-tab selected' : 'file-tab'} onClick={() => void selectFile(file)} disabled={!project || creating}>{file === 'latex' ? 'main.tex' : scriptFiles[file]}</button>)}</div><div>{activeFile === 'latex' ? <><button className="text-button" onClick={() => fileInput.current?.click()} disabled={!project}><Upload size={15}/> Import</button><input ref={fileInput} hidden type="file" accept=".tex,text/plain" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadTex(f); e.currentTarget.value = ''; }}/><button className="text-button" onClick={downloadText} disabled={!project}><Download size={14}/> .tex</button></> : <button className="primary run-button" onClick={() => void runScript(activeFile)} disabled={!project || runBusy}><Play size={13}/>{runBusy ? 'Running…' : 'Run'}</button>}</div></div>
        {creating ? <div className="placeholder" role="status"><LoaderCircle className="spin" size={32}/><h2>Creating project…</h2></div> : project ? <div className="editor-wrapper"><SourceEditor key={`${project.id}:${activeFile}`} language={activeFile} value={activeFile === 'latex' ? latex : scripts[activeFile]} onChange={activeFile === 'latex' ? edit : source => editScript(activeFile, source)} onSave={() => { if (activeFile === 'latex') void save(project.id, latex, projectName, revision.current); else void saveScript(project.id, activeFile, scripts[activeFile]); }} onExecute={() => { if (activeFile === 'latex') void compile(project.id, latex, projectName, revision.current); else void runScript(activeFile); }} requestCompletion={activeFile === 'latex' ? requestCompletion : undefined} onCompletionStatus={activeFile === 'latex' ? setInlineAiStatus : undefined}/></div> : <div className="placeholder"><Code2 size={42}/><h2>Start writing with Patex</h2><p>Create a project to edit LaTeX and generate PDFs.</p><button className="primary" onClick={() => void createProject()}>Create project</button></div>}
        {showDiagnostics && <div className="diagnostics"><div className="diagnostics-head"><Terminal size={14}/> {outputTitle} <button onClick={() => setShowDiagnostics(false)} aria-label="Close output"><X size={15}/></button></div><pre>{diagnostics || 'No output yet'}</pre></div>}
        {activeFile !== 'latex' && artifacts.length > 0 && <div className="artifact-tray"><strong>GENERATED FILES</strong><div className="artifact-list">{artifacts.map(file => <div className="artifact-item" key={file.name}><span>{file.name}</span>{/\.(?:tex|png|jpe?g|pdf)$/i.test(file.name) && <button onClick={() => insertArtifact(file.name)} title={`Insert ${file.name} into LaTeX`}>Insert</button>}<button onClick={() => void downloadArtifact(file.name)} title={`Download ${file.name}`}>Save</button><button onClick={() => void deleteArtifact(file.name)} title={`Delete ${file.name}`}>×</button></div>)}</div></div>}
        <div className="editor-footer"><span>{activeFile === 'latex' ? 'LaTeX' : activeFile.toUpperCase()} · UTF-8</span><span>{(activeFile === 'latex' ? latex : scripts[activeFile]).split('\n').length} lines</span>{activeFile === 'latex' && <span>{inlineAiStatus === 'waiting' ? 'AI suggesting…' : inlineAiStatus === 'unavailable' ? 'AI busy · LaTeX completion available' : 'Tab accepts inline suggestions'}</span>}<button className="text-button" onClick={() => setShowDiagnostics(x => !x)}><Terminal size={14}/> Logs</button><span>Ctrl/Cmd+Enter {activeFile === 'latex' ? 'compile' : 'run'}</span></div>
      </main>
      <div className="splitter" role="separator" aria-label="Resize editor and PDF panels" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={editorWidth} tabIndex={0}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }}
        onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = workbenchRef.current?.getBoundingClientRect(); if (bounds) setEditorWidth(Math.max(25, Math.min(75, Math.round((event.clientX - bounds.left) / bounds.width * 100)))); }}
        onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }}
        onLostPointerCapture={() => setResizing(false)}
        onDoubleClick={() => setEditorWidth(50)}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setEditorWidth(width => Math.max(25, Math.min(75, width + (event.key === 'ArrowRight' ? 2 : -2)))); } if (event.key === 'Home') { event.preventDefault(); setEditorWidth(50); } }} />
      <section className="preview-pane"><div className="pane-head"><span><FileText size={16}/> PDF PREVIEW</span><div><span className="preview-pill"><span className={pdfUrl ? 'dot ready' : 'dot'}/> {pdfUrl ? 'Last successful build' : 'Not compiled'}</span><button className="text-button" onClick={() => void downloadPdf()} disabled={!pdfUrl}><Download size={14}/> PDF</button></div></div><div className="preview-body">{pdfUrl ? <iframe key={pdfUrl} title="PDF preview" src={pdfUrl}/> : <div className="placeholder paper"><FileText size={45}/><h2>Live document preview</h2><p>Your compiled PDF will appear here.</p><span>Press Compile or edit the source to start.</span></div>}</div><div className="preview-footer"><span>PDF preview · Auto-refresh after edits</span>{pdfUrl && <Check size={14}/>}</div></section>
      {aiOpen && <aside className="assistant"><div className="assistant-head"><div><Sparkles size={19}/><strong>Writing assistant</strong></div><button className="icon-button" aria-label="Close assistant" onClick={() => setAiOpen(false)}><PanelRightClose size={18}/></button></div><div className="assistant-intro"><Bot size={27}/><h3>Write better, together.</h3><p>Ask an AI to explain equations, repair LaTeX, or rewrite sections. Suggestions are never applied without your approval.</p></div><label className="field-label" htmlFor="provider">MODEL PROVIDER</label><select id="provider" value={provider} onChange={e => setProvider(e.target.value as Provider)}><option value="llamafarm">LlamaFarm (local)</option><option value="anthropic">Claude API</option><option value="openai">OpenAI API</option></select><div className="assistant-history" aria-live="polite">{aiReply ? <><div className="reply">{aiReply.text}</div>{aiReply.suggestedLatex && <button className="apply-suggestion" onClick={() => { edit(aiReply.suggestedLatex!); setAiReply(null); }}><Check size={15}/> Apply suggested LaTeX</button>}</> : <p>Try: “Fix any LaTeX errors and explain your changes.”</p>}</div><div className="prompt-area"><textarea aria-label="Message to AI assistant" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Ask about this document…" rows={4}/><button className="primary" onClick={() => void askAssistant()} disabled={!project || aiBusy || !prompt.trim()}>{aiBusy ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>} {aiBusy ? 'Thinking…' : 'Ask assistant'}</button><small>Requires configured provider API or LlamaFarm endpoint.</small></div></aside>}
      {connectionsOpen && <aside className="connections-panel" aria-label="Connections panel">
        <div className="assistant-head"><div><Settings2 size={19}/><strong>Connections</strong></div><button className="icon-button" aria-label="Close connections" onClick={() => setConnectionsOpen(false)}><X size={18}/></button></div>
        <p className="connections-intro">Choose the model for inline suggestions and writing help. Server credentials stay on the V100.</p>
        <label className="field-label" htmlFor="active-provider">ACTIVE AI PROVIDER</label>
        <select id="active-provider" value={provider} onChange={e => setProvider(e.target.value as Provider)}><option value="llamafarm">LlamaFarm</option><option value="anthropic">Claude API</option><option value="openai">OpenAI API</option></select>
        <div className="connection-list">{(['llamafarm', 'anthropic', 'openai'] as const).map(item => <div className="connection-card" key={item}><div><strong>{item === 'llamafarm' ? 'LlamaFarm' : item === 'anthropic' ? 'Claude API' : 'OpenAI API'}</strong><span className={integrations?.[item].configured ? 'connection-ready' : 'connection-missing'}>{integrations?.[item].configured ? (item === 'llamafarm' ? 'Endpoint set' : 'Key set') : (item === 'llamafarm' ? 'Needs endpoint' : 'Needs server key')}</span></div><small>{integrations?.[item].model || (item === 'llamafarm' ? 'Set LLAMAFARM_CHAT_URL and LLAMAFARM_MODEL' : `Set ${item === 'anthropic' ? 'ANTHROPIC' : 'OPENAI'}_API_KEY`)}</small></div>)}</div>
        <div className="connection-card mcp-card"><div><strong>Patex MCP tools</strong><span className={integrations?.mcp.configured ? 'connection-ready' : 'connection-missing'}>{integrations?.mcp.configured ? 'Ready' : 'Needs token'}</span></div><code>{window.location.origin}/mcp</code><button className="light" onClick={() => void copyMcpEndpoint()}>Copy endpoint</button><small>Bot clients need the server access token. This page does not expose it.</small></div>
        <label className="token-field"><KeyRound size={15}/><input type="password" aria-label="Patex access token" placeholder="Access token for direct access" value={token} onChange={e => setToken(e.target.value)}/></label>
        <small className="connection-footnote">The SL Labs proxy signs browser API requests automatically. Model availability depends on the provider runtime.</small>
      </aside>}
    </div>
  </div>;
}
