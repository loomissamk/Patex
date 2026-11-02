import { createApp } from './app.js';
import { ProjectStore } from './store.js';
const port = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV === 'production' && !process.env.PATEX_ACCESS_TOKEN) {
  throw new Error('PATEX_ACCESS_TOKEN required in production');
}
const store = new ProjectStore(process.env.PATEX_DATA_DIR || '.patex-data');
const app = createApp(store, { token: process.env.PATEX_ACCESS_TOKEN, compilerUrl: process.env.COMPILER_URL || 'http://127.0.0.1:3001' });
app.listen(port, '0.0.0.0', () => console.log(`Patex listening on ${port}`));
