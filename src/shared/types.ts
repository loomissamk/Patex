export interface ProjectSummary { id: string; name: string; updatedAt: string; hasPdf: boolean }
export interface Project extends ProjectSummary { latex: string }
export type AiProvider = 'llamafarm' | 'anthropic' | 'openai';
export interface CompileResult { ok: boolean; log: string; pdfBase64?: string; }
