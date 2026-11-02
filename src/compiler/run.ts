import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scriptFiles } from '../shared/scripts.js';
import { artifactName } from '../shared/artifacts.js';
import type { Artifact, RunResult, ScriptLanguage } from '../shared/types.js';

const commands: Record<ScriptLanguage, string> = { javascript: 'node', python: 'python3', r: 'Rscript' };
const MAX_SOURCE = 100_000;
const MAX_ARTIFACT = 512 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024;

async function execute(command: string, filename: string, workdir: string): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [filename], {
      cwd: workdir, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin', HOME: workdir, TMPDIR: workdir, LANG: 'C.UTF-8', R_LIBS_USER: workdir },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let tooMuchOutput = false;
    const stop = () => {
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
      catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, 15_000);
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const next = (target === 'stdout' ? stdout : stderr) + chunk.toString('utf8');
      if (target === 'stdout') stdout = next.slice(0, 64_000);
      else stderr = next.slice(0, 64_000);
      if (next.length > 64_000 && !tooMuchOutput) { tooMuchOutput = true; stop(); }
    };
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', exitCode => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr: stderr + (timedOut ? '\nExecution exceeded 15 seconds.' : '') + (tooMuchOutput ? '\nOutput exceeded 64 KB.' : ''), timedOut });
    });
  });
}

export async function runCode(language: ScriptLanguage, source: string): Promise<RunResult> {
  if (!(language in commands) || typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_SOURCE) {
    return { ok: false, exitCode: null, stdout: '', stderr: 'Invalid language or source exceeds 100 KB.', artifacts: [] };
  }
  const workdir = await mkdtemp(path.join(tmpdir(), 'patex-run-'));
  try {
    const filename = scriptFiles[language];
    await writeFile(path.join(workdir, filename), source, { mode: 0o600 });
    const execution = await execute(commands[language], filename, workdir);
    const artifacts: Artifact[] = [];
    let total = 0;
    let artifactError = '';
    for (const entry of await readdir(workdir, { withFileTypes: true })) {
      if (entry.name === filename || !entry.isFile() || !artifactName.test(entry.name)) continue;
      const file = path.join(workdir, entry.name);
      const size = (await stat(file)).size;
      if (size > MAX_ARTIFACT || total + size > MAX_TOTAL || artifacts.length >= 12) { artifactError = '\nArtifact limit exceeded (12 files, 512 KB each, 2 MB total).'; break; }
      artifacts.push({ name: entry.name, base64: (await readFile(file)).toString('base64') });
      total += size;
    }
    return {
      ok: execution.exitCode === 0 && !execution.timedOut && !artifactError,
      exitCode: execution.exitCode,
      stdout: execution.stdout,
      stderr: execution.stderr + artifactError,
      artifacts: artifactError ? [] : artifacts.sort((a, b) => a.name.localeCompare(b.name)),
    };
  } finally { await rm(workdir, { recursive: true, force: true }); }
}
