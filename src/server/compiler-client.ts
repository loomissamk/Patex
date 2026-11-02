import http from 'node:http';
async function rawCompilerRequest<T>(url: string, operation: string, input: unknown, signal?: AbortSignal): Promise<T> {
  if (!url.startsWith('unix:')) {
    const response = await fetch(`${url}/${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(160_000)]) : AbortSignal.timeout(160_000) });
    if (!response.ok) throw new Error(`Compiler returned HTTP ${response.status}`);
    return await response.json() as T;
  }
  return new Promise<T>((resolve, reject) => {
    const body = JSON.stringify(input);
    const request = http.request({ socketPath: url.slice(5), path: `/${operation}`, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, signal }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 60 * 1024 * 1024) response.destroy(new Error('Compiler response limit exceeded')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => { try { if (response.statusCode !== 200) throw new Error(`Compiler returned HTTP ${response.statusCode}`); resolve(JSON.parse(Buffer.concat(chunks).toString()) as T); } catch (error) { reject(error); } });
    });
    request.setTimeout(160_000, () => request.destroy(new Error('Compiler timed out')));
    request.on('error', reject);
    request.end(body);
  });
}

export class WorkerUnavailable extends Error {
  readonly status: number;
  constructor(queueFull = false) { super(queueFull ? 'The document queue is full. Try again shortly.' : 'The document worker is temporarily unavailable. Your edits are saved; try Compile again.'); this.status = queueFull ? 429 : 503; }
}
export async function compilerRequest<T>(url: string, operation: string, input: unknown, signal?: AbortSignal): Promise<T> {
  try { return await rawCompilerRequest<T>(url, operation, input, signal); }
  catch (error) { if (signal?.aborted || (error as Error).name === 'AbortError') throw error; throw new WorkerUnavailable((error as Error).message.includes('HTTP 429')); }
}
