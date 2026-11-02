// This host service orchestrates fixed Docker commands. User code runs only in
// disposable containers; the browser/app never receives a Docker socket.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chmod, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const socket = process.env.PATEX_WORKER_SOCKET || '/tmp/patex-worker/worker.sock';
const image = process.env.PATEX_RUNNER_IMAGE || 'patex-runner';
let active = 0;
const waiting: (() => void)[] = [];
async function slot(): Promise<() => void> {
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  active++;
  return () => { active--; waiting.shift()?.(); };
}
const server = http.createServer(async (request, response) => {
  const reply = (status: number, value: unknown) => { if (!response.destroyed) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); } };
  if (request.url === '/status' || request.url === '/health') { reply(200, { ok: true, isolated: true, network: 'none', active, queued: waiting.length, maxConcurrent: 2, image }); return; }
  if (request.method !== 'POST' || !['/compile', '/run', '/source-map'].includes(request.url || '')) { reply(404, { error: 'Unknown operation' }); return; }
  if (waiting.length >= 12) { reply(429, { error: 'Build queue is full' }); return; }
  let body = '';
  try {
    for await (const chunk of request) { body += String(chunk); if (Buffer.byteLength(body) > 96 * 1024 * 1024) throw new Error('Job input limit exceeded'); }
    const input = JSON.parse(body) as Record<string, unknown>;
    input.operation = request.url!.slice(1);
    const release = await slot();
    if (response.destroyed) { release(); return; }
    const name = `patex-job-${randomUUID()}`;
    let done = false;
    const child = spawn('docker', ['run', '--rm', '-i', '--name', name,
      '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--pids-limit', '128', '--memory', '1536m', '--cpus', '2', '--tmpfs', '/tmp:size=768m,mode=1777',
      '--user', '1000:1000', '-e', 'PATEX_JOB=1', image, 'node', 'dist/node/compiler/job.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = () => { if (!done) { child.kill('SIGKILL'); const cleanup = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' }); cleanup.on('error', () => {}); } };
    const timer = setTimeout(() => { stop(); reply(504, { error: 'Job exceeded 150 seconds' }); }, 150_000);
    let output = ''; let error = '';
    response.on('close', stop);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); if (Buffer.byteLength(output) > 60 * 1024 * 1024) { stop(); reply(502, { error: 'Job output limit exceeded' }); } });
    child.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString()).slice(-2000); });
    child.stdin.on('error', () => {});
    child.on('error', () => { reply(503, { error: 'Isolated worker could not start' }); });
    child.on('close', code => {
      done = true; clearTimeout(timer); release();
      if (code !== 0) { console.error('Patex job failed', name, error.slice(-300)); reply(502, { error: 'Isolated job failed' }); return; }
      try { reply(200, JSON.parse(output)); } catch { reply(502, { error: 'Invalid worker response' }); }
    });
    child.stdin.end(JSON.stringify(input));
  } catch { reply(400, { error: 'Invalid job input' }); }
});
await mkdir(path.dirname(socket), { recursive: true, mode: 0o700 });
await unlink(socket).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
server.listen(socket, () => { void chmod(socket, 0o660); console.log('Patex isolated worker ready'); });
