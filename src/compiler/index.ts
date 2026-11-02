import express from 'express';
import { compileLatex } from './compile.js';
const app = express();
app.use(express.json({ limit: '250kb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/compile', async (req, res) => {
  try {
    if (typeof req.body?.latex !== 'string') { res.status(400).json({ error: 'latex is required' }); return; }
    res.json(await compileLatex(req.body.latex));
  } catch { res.status(500).json({ error: 'Compile worker error' }); }
});
app.listen(Number(process.env.COMPILER_PORT || 3001), '0.0.0.0', () => console.log('Patex compiler ready'));
