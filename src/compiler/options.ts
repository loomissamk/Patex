import type { Project, ProjectFile } from '../shared/types.js';
export interface DocumentOptions { files?: ProjectFile[]; mainFile?: string; engine?: Project['engine']; useCache?: boolean; analysisCache?: ProjectFile[] }
