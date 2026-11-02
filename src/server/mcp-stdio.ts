import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ProjectStore } from './store.js';
import { createPatexMcpServer } from './mcp-server.js';

const store = new ProjectStore(process.env.PATEX_DATA_DIR || '.patex-data');
const server = createPatexMcpServer(store, process.env.COMPILER_URL || 'http://127.0.0.1:3001');
await server.connect(new StdioServerTransport());
