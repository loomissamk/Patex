export interface ProjectSummary { id: string; name: string; updatedAt: string; hasPdf: boolean }
export type ScriptLanguage = 'javascript' | 'python' | 'r';
export type ProjectScripts = Record<ScriptLanguage, string>;
export interface Project extends ProjectSummary { latex: string; scripts: ProjectScripts }
export type AiProvider = 'llamafarm' | 'anthropic' | 'openai';
export interface CompileResult { ok: boolean; log: string; pdfBase64?: string; }
export interface Artifact { name: string; base64: string }
export interface ArtifactSummary { name: string; size: number }
export interface RunResult { ok: boolean; exitCode: number | null; stdout: string; stderr: string; artifacts: Artifact[] }
