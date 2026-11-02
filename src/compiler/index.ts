import express from 'express';
import { compileLatex } from './compile.js';
import { runCode } from './run.js';
import type { ScriptLanguage } from '../shared/types.js';
const app = express();
app.use(express.json({ limit: '4mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/compile', async (req, res) => {
  try {
    if (typeof req.body?.latex !== 'string') { res.status(400).json({ error: 'latex is required' }); return; }
    res.json(await compileLatex(req.body.latex, req.body.assets));
  } catch { res.status(500).json({ error: 'Compile worker error' }); }
});
app.post('/run', async (req, res) => {
  try {
    const { language, source } = req.body || {};
    if (!['javascript', 'python', 'r'].includes(language) || typeof source !== 'string') { res.status(400).json({ error: 'Invalid language or source' }); return; }
    res.json(await runCode(language as ScriptLanguage, source));
  } catch { res.status(500).json({ error: 'Code worker error' }); }
});
app.listen(Number(process.env.COMPILER_PORT || 3001), '0.0.0.0', () => console.log('Patex compiler ready'));
