# Patex — SL Labs LaTeX Studio

A ready-to-extend **TypeScript/React + Node.js** LaTeX/PDF workspace. Edit source on the left, inspect the generated PDF on the right, and ask local/remote AI models to suggest edits. It is a working **MVP**, not a complete Overleaf replacement.

## Features

- Split-screen LaTeX source editor and browser PDF preview
- Creates, names and persists LaTeX projects in a Docker volume
- Debounced autosave and auto-compile after edits; manual **Compile** (Ctrl/Cmd+Enter)
- Shows LaTeX compile errors and keeps the last successful PDF visible
- Download `.tex` or generated `.pdf`; import `.tex` into a project
- Ask LlamaFarm (OpenAI-compatible chat endpoint), Anthropic Claude API, or OpenAI API for LaTeX help
- AI outputs are **suggestions**; explicit Apply button before source changes
- MCP stdio tool server: list/get/create/update/compile projects for Claude Code and other MCP clients
- Separate Debian slim compiler container with restricted permissions, no shell escape, resource limits
- TypeScript strict checking, ESLint, Jest unit/integration tests, SonarQube configuration and GitHub Actions
- Private local-only port `127.0.0.1:4318` intended for Codex-managed Nginx/Tailscale reverse proxy

## Quick start (Docker on V100 host)

```bash
unzip Patex.zip && cd Patex
cp .env.example .env
# Set PATEX_ACCESS_TOKEN to a long random token in .env:
# openssl rand -hex 32
# Configure your optional AI URLs/keys in .env
docker compose -f compose.yml up -d --build
curl http://127.0.0.1:4318/api/health
```

Browse **http://127.0.0.1:4318** from the host, or access via your Tailscale-only reverse proxy. Enter the `PATEX_ACCESS_TOKEN` in the Patex sidebar. Do not paste the server's sudo password into `.env`.

A generic Nginx example is in `infra/nginx-patex.conf.example`. The actual private routes and client hostname setup belong in a separate infrastructure repository. This project does not provision DNS or certificates.

## Local development

Node 22+ required. Install LaTeX (`pdflatex`) if you want to compile locally.

```bash
npm install --no-audit --no-fund
npm run dev:compiler  # terminal 1; requires pdflatex
npm run dev           # terminal 2; API on 3000, Vite UI on 5173
npm run verify
npm run test:coverage
```

For local development the UI is at **http://127.0.0.1:5173**. The browser proxies `/api` to port 3000. API access tokens are optional for local development; set `PATEX_ACCESS_TOKEN` if needed.

## AI integration

Patex does not automatically inherit your ChatGPT/Claude web subscriptions or ChatGPT's tools. Set provider API credentials and a local model endpoint explicitly.

- `LLAMAFARM_CHAT_URL` is the **full** OpenAI-compatible `.../v1/chat/completions` endpoint; set `LLAMAFARM_MODEL` to the **actual** model identifier returned by your server. Do not assume `/mcp` is a chat-completions endpoint.
- `ANTHROPIC_API_KEY` for Claude API; `ANTHROPIC_MODEL` chooses a model available to your key.
- `OPENAI_API_KEY` for OpenAI API; `OPENAI_MODEL` chooses a model available to your key.

For MCP agents, Patex **exposes MCP tools** using its SDK stdio server. Example in Claude Code MCP configuration on the server (or another host with a remote MCP bridge):

```json
{
  "mcpServers": {
    "patex": {
      "command": "docker",
      "args": ["exec", "-i", "patex-app", "node", "dist/node/server/mcp-stdio.js"]
    }
  }
}
```

The MCP server is run inside the app container so it shares the project storage. Remote MCP HTTP transport and **consuming** LlamaFarm's own MCP tools from the Patex chat panel are **future integrations**, not implemented in this MVP. The local LlamaFarm model itself can still work through its chat API. Do not expose `docker exec` access to an untrusted agent.

## Architecture

```text
Browser (editor / PDF / AI chat)
       |  /api/*
Nginx (managed separately; private Tailscale access)
       |
Patex Node/Express API (localhost:4318)
       |-- persistent projects + compiled PDFs (patex-data volume)
       |-- AI providers (LlamaFarm, Claude API, OpenAI API)
       |-- isolated compiler HTTP on Docker network only
       +-- stdio MCP for explicit automation

Compiler container: nonroot Node + pdflatex -no-shell-escape (CPU and memory limits)
```

## Safety and limitations

- Compiler rejects sources over 200 KB and PDFs over 5 MB, uses temporary working directories and disables TeX `shell-escape`. The container is non-root, read-only, and resource limited. TeX is complex; **do not treat this as secure multi-tenant arbitrary-file processing** without further isolation (network denial for compiler plus IPC, seccomp/AppArmor policy, stronger filesystem isolation).
- PDF compilation supports a single `main.tex` document; bibliography/multifile projects and uploaded images are out of scope for the MVP.
- PDF preview uses browser-native embedding, not full PDF.js annotation tools.
- Authentication is a single bearer token and Tailscale boundary; production public deployment requires a more complete identity/access model and TLS.
- When editing rapidly, only one compilation is sent at a time; rapid edits may temporarily leave the last successful PDF visible until another build.
- No direct file management of uploaded PDFs or multiuser collaboration yet.

## Reproducible build

`package-lock.json` is committed. CI and both Docker images use `npm ci` to install pinned dependencies.
