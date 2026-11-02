import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Bot, Check, Code2, Download, FilePlus, FileText, LoaderCircle, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, PanelRightClose, Play, Settings2, Sparkles, Terminal, Upload, X } from 'lucide-react';
import SourceEditor from './SourceEditor';
import ProjectImport from './ProjectImport';
import PdfPreview, { type PdfTarget } from './PdfPreview';
import SessionGate, { type SessionUser } from './SessionGate';
import AccountPanel from './AccountPanel';
import MathLibrary from './MathLibrary';
import { diffLines } from 'diff';
import { publishingTemplates } from '../shared/publishing-templates';
import { defaultScripts, scriptFiles } from '../shared/scripts';
import type { ArtifactSummary, Diagnostic, DocumentFormat, Project, ProjectSummary, ProjectFileSummary, ProjectScripts, RevisionSummary, ScriptLanguage } from '../shared/types';
type Provider = 'llamafarm' | 'anthropic' | 'openai';
type AiReply = { text: string; suggestedLatex: string | null };
type Integrations = Record<Provider, { configured: boolean; model: string }> & { mcp: { configured: boolean } };

export default function App() { return <SessionGate>{(user, logout) => <Workspace key={user.id} user={user} logout={logout}/>}</SessionGate>; }
function Workspace({ user, logout }: { user: SessionUser; logout: () => void }) {
  const [token] = useState(() => sessionStorage.getItem('patex-token') || '');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [latex, setLatex] = useState('');
  const [bibliography, setBibliography] = useState('');
  const [scripts, setScripts] = useState<ProjectScripts>({ ...defaultScripts });
  const [activeFile, setActiveFile] = useState<'latex' | 'bibliography' | ScriptLanguage>('latex');
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
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [draftName, setDraftName] = useState('Untitled Project');
  const [draftFormat, setDraftFormat] = useState<DocumentFormat>('rmd');
  const [draftTemplate, setDraftTemplate] = useState('article');
  const [importOpen, setImportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [insertion, setInsertion] = useState<{ template: string; block: boolean; nonce: number }>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFileSummary[]>([]);
  const [supportPath, setSupportPath] = useState<string | null>(null);
  const [supportText, setSupportText] = useState('');
  const [history, setHistory] = useState<RevisionSummary[] | null>(null);
  const [publishing, setPublishing] = useState<{ citations: string[]; labels: string[]; diagnostics: Diagnostic[] }>({ citations: [], labels: [], diagnostics: [] });
  const [buildDiagnostics, setBuildDiagnostics] = useState<Diagnostic[]>([]);
  const [selection, setSelection] = useState({ from: 0, to: 0, line: 1 });
  const [sourceJump, setSourceJump] = useState<{ line: number; nonce: number }>();
  const [pdfTarget, setPdfTarget] = useState<PdfTarget>();
  const [inlineEnabled, setInlineEnabled] = useState(() => localStorage.getItem('patex-inline-ai') !== 'false');
  const [connectionTests, setConnectionTests] = useState<Partial<Record<Provider, string>>>({});
  const pendingSupportRef = useRef<{ id: string; name: string; source: string } | null>(null);
  const supportInput = useRef<HTMLInputElement>(null);
  const aiBaseRef = useRef(''); const aiController = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const compilingRef = useRef(false);
  const latestEditRef = useRef({ id: '', source: '', name: '' });
  const pendingScriptRef = useRef<{ id: string; language: ScriptLanguage; source: string } | null>(null);
  const pendingBibliographyRef = useRef<{ id: string; source: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const loadedTokenRef = useRef<string | null>(null);
  const projectId = project?.id;

  useEffect(() => { sessionStorage.setItem('patex-token', token); }, [token]);
  useEffect(() => { localStorage.setItem('patex-editor-width', String(editorWidth)); }, [editorWidth]);
  useEffect(() => { localStorage.setItem('patex-inline-ai', String(inlineEnabled)); }, [inlineEnabled]);
  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response;
  }, [token]);
  const refreshFiles = useCallback(async (id: string) => {
    const [files, index] = await Promise.all([api(`/api/projects/${id}/files`), api(`/api/projects/${id}/publishing`)]);
    if (activeProjectRef.current === id) { setProjectFiles(await files.json() as ProjectFileSummary[]); setPublishing(await index.json() as typeof publishing); }
  }, [api]);
  const saveSupport = useCallback(async () => {
    const pending = pendingSupportRef.current; if (!pending) return;
    await api(`/api/projects/${pending.id}/files/content?name=${encodeURIComponent(pending.name)}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: pending.source });
    if (pendingSupportRef.current === pending) pendingSupportRef.current = null;
    setStatus('Supporting file saved'); void refreshFiles(pending.id);
  }, [api, refreshFiles]);
  const requestCompletion = useCallback(async (prefix: string, suffix: string, signal: AbortSignal) => {
    const response = await api('/api/complete', { method: 'POST', signal, body: JSON.stringify({ provider, prefix, suffix, format: project?.format || 'tex' }) });
    const result = await response.json() as { text: string };
    return result.text;
  }, [api, provider, project?.format]);
  useEffect(() => {
    if (!connectionsOpen) return;
    void api('/api/integrations').then(async response => setIntegrations(await response.json() as Integrations)).catch(e => setStatus((e as Error).message));
  }, [api, connectionsOpen]);
  const listProjects = useCallback(async () => {
    const result = await api(`/api/projects?archived=${showArchived}`);
    const entries = await result.json() as ProjectSummary[];
    setProjects(entries);
    return entries;
  }, [api, showArchived]);
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
  const openProject = useCallback(async (id: string, skipSave = false) => {
    try {
      if (!skipSave) await saveSupport();
      if (!skipSave && dirty && project) {
        await api(`/api/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ latex, name: projectName }) });
      }
      const pending = pendingScriptRef.current;
      if (pending) {
        await api(`/api/projects/${pending.id}/scripts/${pending.language}`, { method: 'PUT', body: JSON.stringify({ source: pending.source }) });
        if (pendingScriptRef.current === pending) pendingScriptRef.current = null;
      }
      const pendingBibliography = pendingBibliographyRef.current;
      if (pendingBibliography) {
        await api(`/api/projects/${pendingBibliography.id}/bibliography`, { method: 'PUT', body: JSON.stringify({ bibliography: pendingBibliography.source }) });
        if (pendingBibliographyRef.current === pendingBibliography) pendingBibliographyRef.current = null;
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
      setBibliography(next.bibliography || '');
      setScripts(next.scripts || { ...defaultScripts });
      setActiveFile('latex');
      setSupportPath(null); setProjectFiles([]); setBuildDiagnostics([]);
      setArtifacts([]);
      setDirty(false);
      setDiagnostics('');
      setAiReply(null);
      setInlineAiStatus('ready');
      setStatus('Ready');
      sessionStorage.setItem('patex-last-project', next.id);
      void refreshPdf(next.id);
      void refreshFiles(next.id);
      void api(`/api/projects/${next.id}/artifacts`).then(async response => {
        if (activeProjectRef.current === next.id) setArtifacts(await response.json() as ArtifactSummary[]);
      }).catch(() => {});
    } catch (e) { setStatus((e as Error).message); }
  }, [api, refreshPdf, refreshFiles, saveSupport, dirty, project, latex, projectName]);
  useEffect(() => { void listProjects().catch(error => setStatus((error as Error).message)); }, [listProjects]);
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
    setCreating(true);
    setStatus('Creating project…');
    try {
      const res = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: draftName, format: draftFormat, template: draftTemplate }) });
      const next = await res.json() as Project;
      setNewProjectOpen(false);
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
  useEffect(() => { if (!pendingSupportRef.current) return; const timer = window.setTimeout(() => { void saveSupport().catch(error => setStatus((error as Error).message)); }, 800); return () => window.clearTimeout(timer); }, [supportText, saveSupport]);
  const saveScript = useCallback(async (id: string, language: ScriptLanguage, source: string) => {
    await api(`/api/projects/${id}/scripts/${language}`, { method: 'PUT', body: JSON.stringify({ source }) });
    const pending = pendingScriptRef.current;
    if (pending?.id === id && pending.language === language && pending.source === source) pendingScriptRef.current = null;
    setStatus('Saved');
  }, [api]);
  const saveBibliography = useCallback(async (id: string, source: string) => {
    await api(`/api/projects/${id}/bibliography`, { method: 'PUT', body: JSON.stringify({ bibliography: source }) });
    if (pendingBibliographyRef.current?.id === id && pendingBibliographyRef.current.source === source) pendingBibliographyRef.current = null;
    setStatus('Bibliography saved');
  }, [api]);
  useEffect(() => {
    const pending = pendingBibliographyRef.current;
    if (!pending || pending.id !== projectId) return;
    const timer = window.setTimeout(() => { void saveBibliography(pending.id, pending.source).catch(error => setStatus(`Save failed: ${(error as Error).message}`)); }, 800);
    return () => window.clearTimeout(timer);
  }, [bibliography, projectId, saveBibliography]);
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
  const compile = useCallback(async (id: string, source: string, name: string, rev: number, force = false) => {
    if (compilingRef.current) return;
    compilingRef.current = true;
    setCompiling(true);
    setStatus('Compiling…');
    setOutputTitle('COMPILE OUTPUT');
    try {
      await saveSupport();
      const pendingBibliography = pendingBibliographyRef.current;
      if (pendingBibliography?.id === id) await saveBibliography(id, pendingBibliography.source);
      await save(id, source, name, rev);
      const res = await api(`/api/projects/${id}/compile`, { method: 'POST', body: JSON.stringify({ force }) });
      const result = await res.json() as { ok: boolean; log: string; cached?: boolean; diagnostics?: Diagnostic[] };
      if (revision.current === rev) {
        setDiagnostics(result.log);
        setBuildDiagnostics(result.diagnostics || []);
        setShowDiagnostics(!result.ok);
        setStatus(result.ok ? result.cached ? 'PDF is up to date' : 'Compiled successfully' : 'Build failed — see log');
        if (result.ok && !result.cached) await refreshPdf(id);
        void refreshFiles(id);
      }
    } catch (e) {
      if (revision.current === rev) { setStatus(`Compile failed: ${(e as Error).message}`); setDiagnostics((e as Error).message); setShowDiagnostics(true); }
    } finally {
      compilingRef.current = false;
      setCompiling(false);
      // Edits made during an in-flight build must get their own build.
      const latest = latestEditRef.current;
      if (revision.current !== rev && latest.id === id) {
        window.setTimeout(() => { const next = latestEditRef.current; if (next.id === id) void compile(next.id, next.source, next.name, revision.current); }, 800);
      }
    }
  }, [save, saveBibliography, saveSupport, api, refreshPdf, refreshFiles]);
  // Autosave changes `dirty`; this timer deliberately depends on source, not dirty.
  useEffect(() => {
    if (!projectId) return;
    const timer = window.setTimeout(() => { void compile(projectId, latex, projectName, revision.current); }, 2400);
    return () => window.clearTimeout(timer);
  }, [latex, bibliography, projectName, projectId, compile]);
  const edit = (text: string) => { setLatex(text); revision.current++; latestEditRef.current = { id: projectId || '', source: text, name: projectName }; setDirty(true); setStatus('Editing…'); if (compilingRef.current && projectId) void api(`/api/projects/${projectId}/cancel-build`, { method: 'POST' }).catch(() => {}); };
  const rename = (text: string) => { setProjectName(text); revision.current++; latestEditRef.current = { id: projectId || '', source: latex, name: text }; setDirty(true); };
  const editScript = (language: ScriptLanguage, source: string) => {
    setScripts(current => ({ ...current, [language]: source }));
    pendingScriptRef.current = { id: projectId || '', language, source };
    setStatus('Editing…');
  };
  const editBibliography = (source: string) => {
    setBibliography(source);
    pendingBibliographyRef.current = { id: projectId || '', source };
    revision.current++;
    latestEditRef.current = { id: projectId || '', source: latex, name: projectName };
    setStatus('Editing bibliography…');
  };
  const selectFile = async (file: 'latex' | 'bibliography' | ScriptLanguage) => {
    const pending = pendingScriptRef.current;
    try {
      await saveSupport(); setSupportPath(null);
      if (pending) await saveScript(pending.id, pending.language, pending.source);
      const pendingBibliography = pendingBibliographyRef.current;
      if (pendingBibliography) await saveBibliography(pendingBibliography.id, pendingBibliography.source);
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
    const extension = project.format === 'tex' ? 'tex' : project.format === 'rmd' ? 'Rmd' : 'qmd';
    const blob = new Blob([supportPath ? supportText : latex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = supportPath?.split('/').pop() || `${projectName.replace(/[^a-z0-9-_]/gi, '_') || 'document'}.${extension}`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadBibliography = () => {
    const url = URL.createObjectURL(new Blob([bibliography], { type: 'text/plain' }));
    const link = document.createElement('a'); link.href = url; link.download = 'references.bib'; link.click();
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
    const controller = new AbortController(); aiController.current = controller;
    try {
      await save(project.id, latex, projectName, revision.current);
      aiBaseRef.current = latex;
      const res = await api('/api/assist', { method: 'POST', signal: controller.signal, body: JSON.stringify({ provider, projectId: project.id, prompt, diagnostics, selection: !supportPath && selection.to > selection.from ? { from: selection.from, to: selection.to } : undefined }) });
      setAiReply(await res.json() as AiReply);
    } catch (e) { if (!controller.signal.aborted) setAiReply({ text: (e as Error).message, suggestedLatex: null }); }
    finally { setAiBusy(false); }
  };
  const setFeedbackCapture = async (enabled: boolean) => {
    if (!project) return;
    try {
      await api(`/api/projects/${project.id}/feedback-settings`, { method: 'PUT', body: JSON.stringify({ enabled }) });
      setProject(current => current?.id === project.id ? { ...current, feedbackEnabled: enabled } : current);
      setStatus(enabled ? 'Local AI feedback capture on' : 'Local AI feedback capture off');
    } catch (error) { setStatus((error as Error).message); }
  };
  const recordSuggestion = (decision: 'accepted' | 'rejected') => {
    if (!project || !aiReply?.suggestedLatex) return;
    if (decision === 'accepted' && latex !== aiBaseRef.current) { setStatus('The document changed. Request a new suggestion before applying.'); return; }
    const suggestion = aiReply.suggestedLatex;
    if (project.feedbackEnabled) {
      void api(`/api/projects/${project.id}/feedback`, { method: 'POST', body: JSON.stringify({
        provider, decision, sourceBefore: latex.slice(0, 30_000), suggestion: suggestion.slice(0, 30_000),
        sourceAfter: (decision === 'accepted' ? suggestion : latex).slice(0, 30_000),
      }) }).catch(error => setStatus(`Feedback save failed: ${(error as Error).message}`));
    }
    if (decision === 'accepted') edit(suggestion);
    setAiReply(null);
  };
  const exportFeedback = async () => {
    if (!project) return;
    try {
      const response = await api(`/api/projects/${project.id}/feedback`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `${projectName.replace(/[^a-z0-9-_]/gi, '_') || 'document'}-feedback.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setStatus((error as Error).message); }
  };
  const clearFeedback = async () => {
    if (!project || !window.confirm('Delete all locally saved AI feedback for this project?')) return;
    try { await api(`/api/projects/${project.id}/feedback`, { method: 'DELETE' }); setStatus('Project feedback deleted'); }
    catch (error) { setStatus((error as Error).message); }
  };
  const uploadTex = async (file: File) => {
    if (!project) return;
    if (file.size > 1_000_000) { setStatus('Source is too large'); return; }
    const expected = project.format === 'tex' ? '.tex' : project.format === 'rmd' ? '.rmd' : '.qmd';
    if (!file.name.toLowerCase().endsWith(expected)) { setStatus(`Import a ${expected} file into this project`); return; }
    edit(await file.text());
  };
  const uploadBibliography = async (file: File) => {
    if (file.size > 100_000 || !file.name.toLowerCase().endsWith('.bib')) { setStatus('Import a .bib file under 100 KB'); return; }
    editBibliography(await file.text());
  };
  const flushProject = async () => {
    if (!project) return;
    await saveSupport();
    const bib = pendingBibliographyRef.current; if (bib) await saveBibliography(bib.id, bib.source);
    const script = pendingScriptRef.current; if (script) await saveScript(script.id, script.language, script.source);
    if (dirty) await save(project.id, latex, projectName, revision.current);
  };
  const downloadBundle = async () => {
    if (!project) return;
    try { await flushProject(); const response = await api(`/api/projects/${project.id}/export`); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `${projectName.replace(/[^a-z0-9_-]/gi, '_')}.zip`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus('Portable project exported'); }
    catch (error) { setStatus((error as Error).message); }
  };
  const openSupportingFile = async (file: ProjectFileSummary) => {
    if (!project) return;
    if (file.name === project.mainFile) { await selectFile('latex'); return; }
    const bibPath = project.mainFile.includes('/') ? project.mainFile.slice(0, project.mainFile.lastIndexOf('/') + 1) + 'references.bib' : 'references.bib';
    if (file.name === bibPath) { await selectFile('bibliography'); return; }
    try {
      await saveSupport(); const response = await api(`/api/projects/${project.id}/files/content?name=${encodeURIComponent(file.name)}`);
      if (!file.text || file.size > 1_000_000) { const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = file.name.split('/').pop()!; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
      setSupportText(await response.text()); setSupportPath(file.name); setActiveFile('latex');
    } catch (error) { setStatus((error as Error).message); }
  };
  const uploadSupportingFiles = async (files: FileList | null) => {
    if (!project || !files) return;
    try {
      await flushProject();
      for (const file of Array.from(files)) { if (file.size > 8 * 1024 * 1024) throw new Error('Each file must be under 8 MB'); const name = file.webkitRelativePath || file.name; await api(`/api/projects/${project.id}/files/content?name=${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: file }); }
      await refreshFiles(project.id); revision.current++; latestEditRef.current = { id: project.id, source: latex, name: projectName }; void compile(project.id, latex, projectName, revision.current); setStatus('Supporting files added');
    } catch (error) { setStatus((error as Error).message); }
  };
  const archiveProject = async () => {
    if (!project || !window.confirm(project.archived ? 'Restore this project to the workspace?' : 'Archive this project? You can restore it from Archived projects.')) return;
    try { await flushProject(); await api(`/api/projects/${project.id}/archive`, { method: 'PUT', body: JSON.stringify({ archived: !project.archived }) }); activeProjectRef.current = ''; setProject(null); setLatex(''); setDirty(false); setPdfUrl(null); setSupportPath(null); await listProjects(); }
    catch (error) { setStatus((error as Error).message); }
  };
  const openHistory = async () => { if (!project) return; try { await flushProject(); const response = await api(`/api/projects/${project.id}/history`); setHistory(await response.json() as RevisionSummary[]); } catch (error) { setStatus((error as Error).message); } };
  const restoreRevision = async (id: string) => {
    if (!project || !window.confirm('Restore this revision? The current version is saved to history first.')) return;
    try { await api(`/api/projects/${project.id}/cancel-build`, { method: 'POST' }); await api(`/api/projects/${project.id}/history/${id}/restore`, { method: 'POST' }); pendingSupportRef.current = null; pendingBibliographyRef.current = null; pendingScriptRef.current = null; setHistory(null); await openProject(project.id, true); }
    catch (error) { setStatus((error as Error).message); }
  };
  const navigateSource = async (page: number, x: number, y: number) => {
    if (!project) return;
    try {
      const r = await api(`/api/projects/${project.id}/source-map`, { method: 'POST', body: JSON.stringify({ mode: 'inverse', page, x, y }) }); const location = await r.json() as { file?: string; line?: number };
      if (location.file && location.file !== project.mainFile) { const file = projectFiles.find(f => f.name === location.file); if (file) await openSupportingFile(file); } else await selectFile('latex');
      if (location.line) setSourceJump({ line: location.line, nonce: Date.now() });
    } catch (error) { setStatus((error as Error).message); }
  };
  const navigatePdf = async () => {
    if (!project) return;
    try { const r = await api(`/api/projects/${project.id}/source-map`, { method: 'POST', body: JSON.stringify({ mode: 'forward', file: supportPath || project.mainFile, line: selection.line }) }); const location = await r.json() as { page?: number; x?: number; y?: number }; if (location.page) setPdfTarget({ page: location.page, x: location.x, y: location.y, nonce: Date.now() }); else setStatus('No PDF location for this source line'); }
    catch (error) { setStatus((error as Error).message); }
  };
  const testConnection = async (item: Provider) => { setConnectionTests(s => ({ ...s, [item]: 'Testing…' })); try { const r = await api(`/api/integrations/${item}/test`, { method: 'POST' }); const result = await r.json() as { ok: boolean; latencyMs: number; error?: string }; setConnectionTests(s => ({ ...s, [item]: result.ok ? `Responded in ${result.latencyMs} ms` : result.error || 'Unavailable' })); } catch (error) { setConnectionTests(s => ({ ...s, [item]: (error as Error).message })); } };
  const mainFile = project?.mainFile || (project?.format === 'rmd' ? 'main.Rmd' : project?.format === 'qmd' ? 'main.qmd' : 'main.tex');
  const fileTabs: readonly ('latex' | 'bibliography' | ScriptLanguage)[] = project?.format && project.format !== 'tex' ? ['latex', 'bibliography'] : ['latex', 'bibliography', 'javascript', 'python', 'r'];
  const editorValue = supportPath ? supportText : activeFile === 'latex' ? latex : activeFile === 'bibliography' ? bibliography : scripts[activeFile];
  const editorLanguage = supportPath ? /\.(r)$/i.test(supportPath) ? 'r' : /\.py$/i.test(supportPath) ? 'python' : /\.(js|ts|json)$/i.test(supportPath) ? 'javascript' : /\.bib$/i.test(supportPath) ? 'bibliography' : /\.(tex|latex|sty|cls)$/i.test(supportPath) ? 'latex' : 'rmd' : activeFile === 'latex' ? project?.format === 'rmd' ? 'rmd' : project?.format === 'qmd' ? 'qmd' : 'latex' : activeFile;
  const editActiveFile = (source: string) => {
    if (supportPath && project) { setSupportText(source); pendingSupportRef.current = { id: project.id, name: supportPath, source }; revision.current++; setStatus('Editing supporting file…'); }
    else if (activeFile === 'latex') edit(source);
    else if (activeFile === 'bibliography') editBibliography(source);
    else editScript(activeFile, source);
  };
  const saveActiveFile = () => {
    if (!project) return;
    if (supportPath) void saveSupport();
    else if (activeFile === 'latex') void save(project.id, latex, projectName, revision.current);
    else if (activeFile === 'bibliography') void saveBibliography(project.id, bibliography);
    else void saveScript(project.id, activeFile, scripts[activeFile]);
  };
  const executeActiveFile = () => {
    if (!project) return;
    if (activeFile === 'latex' || activeFile === 'bibliography') void compile(project.id, latex, projectName, revision.current);
    else void runScript(activeFile);
  };
  return <div className={`shell${focusMode ? ' focus-mode' : ''}${sidebarOpen ? ' sidebar-open' : ''}`}>
    <header className="topbar">
      <button className="light project-panel-toggle" aria-label={sidebarOpen ? 'Hide project sidebar' : 'Show project sidebar'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(x => !x)}>{sidebarOpen ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}<span>Projects</span></button>
      <div className="logo"><span className="brand-symbol">P</span><div><strong>Patex</strong><small>SL Labs / LaTeX Studio</small></div></div>
      <div className="project-heading">{project ? <><FileText size={16}/><input aria-label="Project name" value={projectName} onChange={e => rename(e.target.value)} /></> : <span>Select a project</span>}</div>
      <div className="actions">
        <span className={`status ${status.includes('failed') || status.includes('errors') ? 'bad' : ''}`}>{compiling && <LoaderCircle className="spin" size={14}/>} {status}</span>
        <button className="light" onClick={() => setNewProjectOpen(true)} disabled={creating} title="New project"><FilePlus size={16}/> New</button>
        <button className="primary" onClick={() => project && void compile(project.id, latex, projectName, revision.current, true)} disabled={!project || compiling}><Play size={15} fill="currentColor"/> Compile</button>
        <button className="light focus-toggle" aria-label={focusMode ? 'Exit 50/50 focus mode' : 'Enter 50/50 focus mode'} aria-pressed={focusMode} onClick={() => { setFocusMode(x => !x); setSidebarOpen(focusMode); }} >{focusMode ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}<span>{focusMode ? 'Exit focus' : '50/50 focus'}</span></button>
        <button className="light" onClick={() => { setLibraryOpen(x => !x); setAiOpen(false); setConnectionsOpen(false); }}>∑ Library</button><button className="light account-button" onClick={() => setAccountOpen(true)}>{user.username}</button>{compiling && <button className="light" onClick={() => project && void api(`/api/projects/${project.id}/cancel-build`, { method: 'POST' })}>Cancel build</button>}<button className="icon-button" title="Writing assistant" aria-label="Writing assistant" onClick={() => { setAiOpen(x => !x); setConnectionsOpen(false); setLibraryOpen(false); }}><Sparkles size={19}/></button>
        <button className="icon-button" title="Connections" aria-label="Connections" onClick={() => { setConnectionsOpen(x => !x); setAiOpen(false); setLibraryOpen(false); }}><Settings2 size={19}/></button>
      </div>
    </header>
    <div className={`workbench${resizing ? ' resizing' : ''}`} ref={workbenchRef} style={{ '--editor-width': `${editorWidth}%` } as CSSProperties}>
      <aside className="sidebar">
        <div className="sidebar-heading"><strong>WORKSPACE</strong><button className="icon-button" title="New project" disabled={creating} onClick={() => setNewProjectOpen(true)}><FilePlus size={18}/></button></div>
        <button className="new-project" disabled={creating} onClick={() => setNewProjectOpen(true)}><FilePlus size={16}/> New project</button>
        <button className="new-project" onClick={() => setImportOpen(true)}><Upload size={16}/> Open ZIP / folder</button>
        <label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/> Archived projects</label>
        <div className="nav-header"><BookOpen size={13}/> PROJECTS</div>
        {projects.map(p => <button key={p.id} className={`project-item ${p.id === project?.id ? 'selected' : ''}`} onClick={() => { void openProject(p.id); if (focusMode) setSidebarOpen(false); }}><FileText size={16}/><span>{p.name}</span></button>)}
        {projects.length === 0 && <p className="empty-sidebar">Create a project to begin writing.</p>}
        {project && <div className="project-tools"><button onClick={() => void downloadBundle()}>Export project ZIP</button><button onClick={() => void openHistory()}>Version history</button><button onClick={() => void archiveProject()}>{project.archived ? 'Restore project' : 'Archive project'}</button><div className="nav-header">PROJECT FILES</div><div className="file-tree">{projectFiles.map(file => <button className={supportPath === file.name || (!supportPath && file.name === mainFile) ? 'selected' : ''} title={`${file.name} · ${file.size} bytes`} key={file.name} onClick={() => void openSupportingFile(file)}>{file.text ? '≡' : '▧'} {file.name}</button>)}</div><div className="file-upload-actions"><button onClick={() => supportInput.current?.click()}>Add files</button><button onClick={() => (document.getElementById('support-folder-input') as HTMLInputElement | null)?.click()}>Add folder</button></div><input hidden multiple ref={supportInput} type="file" onChange={event => void uploadSupportingFiles(event.target.files)}/><input hidden multiple ref={element => element?.setAttribute('webkitdirectory', '')} type="file" onChange={event => void uploadSupportingFiles(event.target.files)} id="support-folder-input"/></div>}
      </aside>
      <main className="editor-workspace">
        <div className="pane-head file-head">
          <div className="file-tabs" role="tablist" aria-label="Project files">{fileTabs.map(file => <button key={file} role="tab" aria-selected={activeFile === file && !supportPath} className={activeFile === file && !supportPath ? 'file-tab selected' : 'file-tab'} onClick={() => void selectFile(file)} disabled={!project || creating}>{file === 'latex' ? mainFile : file === 'bibliography' ? 'references.bib' : scriptFiles[file]}</button>)}{supportPath && <button role="tab" aria-selected="true" className="file-tab selected">{supportPath}</button>}</div>
          <div>{project?.format === 'tex' && <><select aria-label="PDF engine" className="engine-select" value={project.engine || 'pdflatex'} onChange={event => { const engine = event.target.value as Project['engine']; void flushProject().then(() => api(`/api/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ engine }) })).then(async r => { setProject(await r.json() as Project); revision.current++; void compile(project.id, latex, projectName, revision.current, true); }).catch(error => setStatus((error as Error).message)); }}><option>pdflatex</option><option>xelatex</option><option>lualatex</option></select><button className="text-button" disabled={!pdfUrl || dirty || compiling} onClick={() => void navigatePdf()}>Find in PDF</button></>}{activeFile === 'latex' || activeFile === 'bibliography' ? <><button className="text-button" onClick={() => fileInput.current?.click()} disabled={!project}><Upload size={15}/> Import</button><input ref={fileInput} hidden type="file" accept={activeFile === 'bibliography' ? '.bib' : project?.format === 'rmd' ? '.Rmd' : project?.format === 'qmd' ? '.qmd' : '.tex'} onChange={e => { const f = e.target.files?.[0]; if (f) void (activeFile === 'bibliography' ? uploadBibliography(f) : uploadTex(f)); e.currentTarget.value = ''; }}/><button className="text-button" onClick={activeFile === 'bibliography' ? downloadBibliography : downloadText} disabled={!project}><Download size={14}/> Source</button></> : <button className="primary run-button" onClick={() => void runScript(activeFile)} disabled={!project || runBusy}><Play size={13}/>{runBusy ? 'Running…' : 'Run'}</button>}</div>
        </div>
        {creating ? <div className="placeholder" role="status"><LoaderCircle className="spin" size={32}/><h2>Creating project…</h2></div> : project ? <div className="editor-wrapper"><SourceEditor key={`${project.id}:${supportPath || activeFile}`} language={editorLanguage} value={editorValue} onChange={editActiveFile} onSave={saveActiveFile} onExecute={executeActiveFile} requestCompletion={activeFile === 'latex' && !supportPath && inlineEnabled ? requestCompletion : undefined} onCompletionStatus={activeFile === 'latex' ? setInlineAiStatus : undefined} citationKeys={publishing.citations} labels={publishing.labels} onCursor={setSelection} jumpTo={sourceJump} insertSnippet={insertion} onInserted={() => setInsertion(undefined)} diagnostics={[...buildDiagnostics, ...publishing.diagnostics].filter(item => !item.file || item.file === (supportPath || mainFile))}/></div> : <div className="placeholder"><Code2 size={42}/><h2>Start writing with Patex</h2><p>Create a document to write and preview its PDF.</p><button className="primary" onClick={() => setNewProjectOpen(true)}>Create project</button></div>}
        {showDiagnostics && <div className="diagnostics"><div className="diagnostics-head"><Terminal size={14}/> {outputTitle} <button onClick={() => setShowDiagnostics(false)} aria-label="Close output"><X size={15}/></button></div><pre>{diagnostics || 'No output yet'}</pre></div>}
        {activeFile !== 'latex' && activeFile !== 'bibliography' && artifacts.length > 0 && <div className="artifact-tray"><strong>GENERATED FILES</strong><div className="artifact-list">{artifacts.map(file => <div className="artifact-item" key={file.name}><span>{file.name}</span>{/\.(?:tex|png|jpe?g|pdf)$/i.test(file.name) && <button onClick={() => insertArtifact(file.name)} title={`Insert ${file.name} into LaTeX`}>Insert</button>}<button onClick={() => void downloadArtifact(file.name)} title={`Download ${file.name}`}>Save</button><button onClick={() => void deleteArtifact(file.name)} title={`Delete ${file.name}`}>×</button></div>)}</div></div>}
        {[...buildDiagnostics, ...publishing.diagnostics].length > 0 && <div className="diagnostic-list">{[...buildDiagnostics, ...publishing.diagnostics].slice(0, 12).map((item, i) => <button key={i} onClick={() => { const file = projectFiles.find(f => f.name === item.file); if (file && item.file !== mainFile) void openSupportingFile(file); else void selectFile('latex'); if (item.line) setSourceJump({ line: item.line, nonce: Date.now() }); }}>{item.severity}: {item.file || mainFile}{item.line ? `:${item.line}` : ''} · {item.message}</button>)}</div>}
        <div className="editor-footer"><span>{activeFile === 'latex' ? project?.format === 'rmd' ? 'R Markdown' : project?.format === 'qmd' ? 'Quarto' : 'LaTeX' : activeFile === 'bibliography' ? 'BibTeX' : activeFile.toUpperCase()} · UTF-8</span><span>{editorValue.split('\n').length} lines</span>{activeFile === 'latex' && <span>{inlineAiStatus === 'waiting' ? 'AI suggesting…' : inlineAiStatus === 'unavailable' ? 'AI busy · local completion available' : 'Tab accepts inline suggestions'}</span>}<button className="text-button" onClick={() => setShowDiagnostics(x => !x)}><Terminal size={14}/> Logs</button><span>Ctrl/Cmd+Enter {activeFile === 'latex' || activeFile === 'bibliography' ? 'compile' : 'run'}</span></div>
      </main>
      <div className="splitter" role="separator" aria-label="Resize editor and PDF panels" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={editorWidth} tabIndex={0}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }}
        onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = workbenchRef.current?.getBoundingClientRect(); if (bounds) setEditorWidth(Math.max(25, Math.min(75, Math.round((event.clientX - bounds.left) / bounds.width * 100)))); }}
        onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }}
        onLostPointerCapture={() => setResizing(false)}
        onDoubleClick={() => setEditorWidth(50)}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setEditorWidth(width => Math.max(25, Math.min(75, width + (event.key === 'ArrowRight' ? 2 : -2)))); } if (event.key === 'Home') { event.preventDefault(); setEditorWidth(50); } }} />
      <section className="preview-pane"><div className="pane-head"><span><FileText size={16}/> PDF PREVIEW</span><div><span className="preview-pill"><span className={pdfUrl ? 'dot ready' : 'dot'}/> {pdfUrl ? 'Last successful build' : 'Not compiled'}</span><button className="text-button" onClick={() => void downloadPdf()} disabled={!pdfUrl}><Download size={14}/> PDF</button></div></div><div className="preview-body">{pdfUrl ? <PdfPreview url={pdfUrl} target={pdfTarget} onLocate={project?.format === 'tex' ? (page, x, y) => void navigateSource(page, x, y) : undefined}/> : <div className="placeholder paper"><FileText size={45}/><h2>Live document preview</h2><p>Your compiled PDF will appear here.</p><span>Press Compile or edit the source to start.</span></div>}</div><div className="preview-footer"><span>PDF preview · Auto-refresh after edits</span>{pdfUrl && <Check size={14}/>}</div></section>
      {aiOpen && <aside className="assistant"><div className="assistant-head"><div><Sparkles size={19}/><strong>Writing assistant</strong></div><button className="icon-button" aria-label="Close assistant" onClick={() => setAiOpen(false)}><PanelRightClose size={18}/></button></div><div className="assistant-intro"><Bot size={27}/><h3>Write better, together.</h3><p>Ask an AI to explain equations, repair source, or improve a section. You decide what gets applied.</p></div><label className="field-label" htmlFor="provider">MODEL PROVIDER</label><select id="provider" value={provider} onChange={e => setProvider(e.target.value as Provider)}><option value="llamafarm">LlamaFarm (local)</option><option value="anthropic">Claude API</option><option value="openai">OpenAI API</option></select><div className="assistant-history" aria-live="polite">{aiReply ? <><div className="reply">{aiReply.text.replace(/`{4}[\s\S]*?`{4}/g, '[Proposed edit below]')}</div>{aiReply.suggestedLatex && <pre className="proposal-diff" aria-label="Review proposed changes">{diffLines(aiBaseRef.current, aiReply.suggestedLatex).map((part, i) => <span key={i} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-context'}>{part.value}</span>)}</pre>}{aiReply.suggestedLatex && <div className="suggestion-actions"><button className="apply-suggestion" onClick={() => recordSuggestion('accepted')}><Check size={15}/> Apply reviewed edit</button><button className="light" onClick={() => recordSuggestion('rejected')}>Reject</button></div>}</> : <p>Try: “Fix this build error and explain the change.”</p>}</div><div className="prompt-area"><label className="feedback-toggle"><input type="checkbox" checked={project?.feedbackEnabled || false} disabled={!project} onChange={event => void setFeedbackCapture(event.target.checked)}/> Save my AI decisions in this project</label><small>Off by default. Feedback stays on this server and is never sent to model training automatically.</small><div className="feedback-actions"><button className="text-button" disabled={!project} onClick={() => void exportFeedback()}>Export feedback</button><button className="text-button" disabled={!project} onClick={() => void clearFeedback()}>Delete feedback</button></div><textarea aria-label="Message to AI assistant" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Ask about this document…" rows={4}/><button className="primary" onClick={() => void askAssistant()} disabled={!project || aiBusy || !prompt.trim()}>{aiBusy ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>} {aiBusy ? 'Thinking…' : 'Ask assistant'}</button>{aiBusy && <button className="light" onClick={() => { aiController.current?.abort(); setAiBusy(false); }}>Cancel AI request</button>}<small>{selection.to > selection.from && !supportPath ? 'The selected passage will be revised.' : 'Select text in the main document to target an edit.'}</small></div></aside>}
      {connectionsOpen && <aside className="connections-panel" aria-label="Connections panel">
        <div className="assistant-head"><div><Settings2 size={19}/><strong>Connections</strong></div><button className="icon-button" aria-label="Close connections" onClick={() => setConnectionsOpen(false)}><X size={18}/></button></div>
        <p className="connections-intro">Choose the model for inline suggestions and writing help. Test its response before relying on it.</p><label className="feedback-toggle"><input type="checkbox" checked={inlineEnabled} onChange={event => setInlineEnabled(event.target.checked)}/> Enable inline AI suggestions</label>
        <label className="field-label" htmlFor="active-provider">ACTIVE AI PROVIDER</label>
        <select id="active-provider" value={provider} onChange={e => setProvider(e.target.value as Provider)}><option value="llamafarm">LlamaFarm</option><option value="anthropic">Claude API</option><option value="openai">OpenAI API</option></select>
        <div className="connection-list">{(['llamafarm', 'anthropic', 'openai'] as const).map(item => <div className="connection-card" key={item}><div><strong>{item === 'llamafarm' ? 'LlamaFarm' : item === 'anthropic' ? 'Claude API' : 'OpenAI API'}</strong><span className={integrations?.[item].configured ? 'connection-ready' : 'connection-missing'}>{integrations?.[item].configured ? (item === 'llamafarm' ? 'Endpoint set' : 'Key set') : (item === 'llamafarm' ? 'Needs endpoint' : 'Needs server key')}</span></div><small>{integrations?.[item].model || (item === 'llamafarm' ? 'Set LLAMAFARM_CHAT_URL and LLAMAFARM_MODEL' : `Set ${item === 'anthropic' ? 'ANTHROPIC' : 'OPENAI'}_API_KEY`)}</small><button className="light" onClick={() => void testConnection(item)}>Test response</button><small role="status">{connectionTests[item] || 'Not tested this session'}</small></div>)}</div>
        <div className="connection-card mcp-card"><div><strong>Patex MCP tools</strong><span className={integrations?.mcp.configured ? 'connection-ready' : 'connection-missing'}>{integrations?.mcp.configured ? 'Ready' : 'Needs token'}</span></div><code>{window.location.origin}/mcp</code><button className="light" onClick={() => void copyMcpEndpoint()}>Copy endpoint</button><small>Create an account API token to connect a bot to your projects.</small></div>
        <button className="light" onClick={() => setAccountOpen(true)}>Manage account and MCP tokens</button>
        <small className="connection-footnote">Browser access uses your private session. MCP clients use an account API token. Model availability depends on the provider runtime.</small>
      </aside>}
    </div>
    {importOpen && <ProjectImport api={api} onClose={() => setImportOpen(false)} onImported={async next => { setShowArchived(false); await listProjects(); await openProject(next.id); }}/>}
    {accountOpen && <AccountPanel user={user} api={api} onClose={() => setAccountOpen(false)} logout={logout}/>}
    {history && <div className="dialog-backdrop"><section className="project-dialog history-dialog" aria-label="Version history"><div className="dialog-heading"><h2>Version history</h2><button onClick={() => setHistory(null)}>×</button></div><p>Restore the document and supporting files together.</p>{history.length === 0 && <p>Edits create recoverable revisions automatically.</p>}{history.map(revision => <button className="history-entry" key={revision.id} onClick={() => void restoreRevision(revision.id)}><span>{new Date(revision.at).toLocaleString()}</span><small>{revision.name}</small></button>)}</section></div>}
    {libraryOpen && <MathLibrary onClose={() => setLibraryOpen(false)} onInsert={(template, block) => { setSupportPath(null); setActiveFile('latex'); setInsertion({ template, block, nonce: Date.now() }); }}/>}
    {newProjectOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setNewProjectOpen(false); }}>
      <form className="project-dialog" aria-label="Create document" onSubmit={event => { event.preventDefault(); void createProject(); }}>
        <div className="dialog-heading"><h2>New document</h2><button type="button" className="icon-button" aria-label="Close" onClick={() => setNewProjectOpen(false)}><X size={17}/></button></div>
        <label>Name<input autoFocus maxLength={100} value={draftName} onChange={event => setDraftName(event.target.value)}/></label>
        <label>Source format<select value={draftFormat} onChange={event => setDraftFormat(event.target.value as DocumentFormat)}><option value="rmd">R Markdown — math, R, Python, and Node in one file</option><option value="qmd">Quarto — literate document</option><option value="tex">LaTeX — native .tex</option></select></label>
        {draftFormat === 'tex' && <label>Template<select value={draftTemplate} onChange={event => setDraftTemplate(event.target.value)}>{Object.entries(publishingTemplates).map(([key, value]) => <option value={key} key={key}>{value.name}</option>)}</select></label>}
        <p>Write in one source file. The PDF builds beside it after you pause typing.</p>
        <button type="submit" className="primary" disabled={creating || !draftName.trim()}>{creating ? 'Creating…' : 'Create document'}</button>
      </form>
    </div>}
  </div>;
}
