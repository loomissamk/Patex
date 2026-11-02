import { compileLatex } from './compile.js';
import { renderLiterate } from './render.js';
import { runCode } from './run.js';
import type { DocumentOptions } from './options.js';
import type { DocumentFormat, ScriptLanguage } from '../shared/types.js';
import { sourceMap, type SyncInput } from './sync.js';
let raw = '';
for await (const chunk of process.stdin) { raw += String(chunk); if (Buffer.byteLength(raw) > 96 * 1024 * 1024) throw new Error('Job input limit exceeded'); }
const input = JSON.parse(raw) as DocumentOptions & { operation: string; latex: string; format: DocumentFormat; bibliography?: string; language: ScriptLanguage; source: string };
let result: unknown;
if (input.operation === 'compile' && ['tex', 'rmd', 'qmd'].includes(input.format)) result = input.format === 'tex' ? await compileLatex(input.latex, [], input.bibliography, input) : await renderLiterate(input.latex, input.format, [], input.bibliography, input);
else if (input.operation === 'run' && ['r', 'python', 'javascript'].includes(input.language)) result = await runCode(input.language, input.source);
else if (input.operation === 'source-map') result = await sourceMap(input as unknown as SyncInput);
else throw new Error('Invalid job operation');
process.stdout.write(JSON.stringify(result));
