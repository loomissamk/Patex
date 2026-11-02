export interface ProjectSummary { id: string; name: string; updatedAt: string; hasPdf: boolean; archived?: boolean }
export type ScriptLanguage = 'javascript' | 'python' | 'r';
export type DocumentFormat = 'tex' | 'rmd' | 'qmd';
export type ProjectScripts = Record<ScriptLanguage, string>;
export interface Project extends ProjectSummary { latex: string; format: DocumentFormat; mainFile: string; engine: 'pdflatex' | 'xelatex' | 'lualatex'; bibliography: string; scripts: ProjectScripts; feedbackEnabled: boolean }
export interface ProjectFile { name: string; base64: string }
export interface ProjectFileSummary { name: string; size: number; text: boolean }
export interface RevisionSummary { id: string; at: string; name: string }
export type AiProvider = 'llamafarm' | 'anthropic' | 'openai';
export interface FeedbackEvent { id: string; at: string; provider: AiProvider; decision: 'accepted' | 'rejected'; sourceBefore: string; suggestion: string; sourceAfter: string }
export interface CompileResult { ok: boolean; log: string; pdfBase64?: string; synctexBase64?: string; sourceRoot?: string; diagnostics?: Diagnostic[]; cached?: boolean; analysisCache?: ProjectFile[] }
export interface Diagnostic { severity: 'error' | 'warning'; message: string; file?: string; line?: number }
export interface Artifact { name: string; base64: string }
export interface ArtifactSummary { name: string; size: number }
export interface RunResult { ok: boolean; exitCode: number | null; stdout: string; stderr: string; artifacts: Artifact[] }
