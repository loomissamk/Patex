# Patex — SL Labs LaTeX Studio

A ready-to-extend **TypeScript/React + Node.js** LaTeX/PDF workspace. Edit source on the left, inspect the generated PDF on the right, and ask local/remote AI models to suggest edits. It is a working **MVP**, not a complete Overleaf replacement.

The browser editor works on macOS, Windows, and Linux. Its Ctrl/Cmd shortcuts use the platform's modifier key. The private `.sl` hostname requires Tailscale and a client hosts entry on each computer; the separate infrastructure repository includes Mac/Linux and Windows installers.

## Features

- Default 50/50 LaTeX source and live PDF view, with a collapsible project panel
- Draggable editor/PDF split; double-click the divider or press Home on it to restore 50/50
- CodeMirror LaTeX editor with command completion and AI text suggested at the cursor; Tab accepts and Escape dismisses
- Creates, names and persists LaTeX projects in a Docker volume
- Debounced autosave and auto-compile after edits; manual **Compile** (Ctrl/Cmd+Enter)
- Shows LaTeX compile errors and keeps the last successful PDF visible
- Download `.tex` or generated `.pdf`; import `.tex` into a project
- Edit and run JavaScript, Python, and R in project tabs; see console output and save generated files
- Insert generated `.tex`, `.png`, `.jpg`, or `.pdf` files into the LaTeX source and rebuild the PDF
- Ask LlamaFarm (OpenAI-compatible chat endpoint), Anthropic Claude API, or OpenAI API for LaTeX help
- AI outputs are **suggestions**; explicit Apply button before source changes
- MCP stdio and token-protected Streamable HTTP tools: list/get/create/update/compile projects for Claude Code, Codex and other MCP clients
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

Browse **http://127.0.0.1:4318** from the host, or access via your Tailscale-only reverse proxy. For direct access, open **Projects** and enter the `PATEX_ACCESS_TOKEN` in the sidebar. The SL Labs Nginx setup injects that token for browser `/api/` requests. Do not paste the server's sudo password into `.env`.

A generic Nginx example is in `infra/nginx-patex.conf.example`. The actual private routes and client hostname setup belong in a separate infrastructure repository. This project does not provision DNS or certificates.

## Local development

Node 22+ required. Install LaTeX (`pdflatex`) to compile locally, and install Python 3 or R to run those languages without Docker. The Docker compiler image includes all three runtimes.

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

The editor offers LaTeX command completions locally. After you pause typing at the end of a line, it requests an inline text suggestion from the selected provider. Model suggestions depend on provider availability and response time; editing, saving and compiling continue when a model is busy or offline.

- `LLAMAFARM_CHAT_URL` is the **full** OpenAI-compatible `.../v1/chat/completions` endpoint; set `LLAMAFARM_MODEL` to the **actual** model identifier returned by your server. Do not assume `/mcp` is a chat-completions endpoint.
- `ANTHROPIC_API_KEY` for Claude API; `ANTHROPIC_MODEL` chooses a model available to your key.
- `OPENAI_API_KEY` for OpenAI API; `OPENAI_MODEL` chooses a model available to your key.

For MCP agents, Patex exposes the same project tools over stdio and `POST /mcp` (Streamable HTTP). The HTTP endpoint requires `Authorization: Bearer <PATEX_ACCESS_TOKEN>` and a hostname listed in `PATEX_MCP_ALLOWED_HOSTS`. Example stdio configuration for a client that has controlled Docker access on the server:

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

The stdio server runs inside the app container so it shares project storage. The HTTP route makes those tools available to remote MCP clients over your private network when they have the token. The Patex chat panel calls LlamaFarm's chat API; **consuming LlamaFarm's own MCP tools** from that panel is not implemented. Do not expose `docker exec` access to an untrusted agent.

## Research code in a document

Open `analysis.js`, `analysis.py`, or `analysis.R`, edit the script, and press **Run** (or Ctrl/Cmd+Enter). Console output appears below the editor. Files the script writes in its working directory appear in **Generated files**; use **Insert** for TeX snippets and images. For example, the starter JavaScript and Python scripts create a number that can be inserted with `\input{assets/js-result.tex}` or `\input{assets/python-result.tex}`. The R starter script creates a PNG plot; Patex adds `graphicx` when you insert it. Recompile to see the result in the PDF pane.

Scripts run for at most 15 seconds. Source is limited to 100 KB, console output to 64 KB per stream, and generated files to 12 files / 512 KB each / 2 MB per project. The image includes Node 22, Debian Python 3, and Debian R with base packages. Scripts do not install packages or upload datasets yet. Generated files are preserved with the project until deleted.

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

Compiler container: nonroot Node + Python 3 + R + pdflatex -no-shell-escape (CPU and memory limits)
```

## Safety and limitations

- Compiler rejects sources over 200 KB and PDFs over 5 MB, uses temporary working directories and disables TeX `shell-escape`. Script execution has time/output/artifact limits. The container is non-root, read-only, and resource limited. It still shares an internal network with the app. **Do not offer this runner to untrusted public users** without stronger per-run network and filesystem isolation, process limits, rate limits, and a security review.
- PDF compilation supports a single `main.tex` document plus generated artifacts; bibliography, arbitrary multi-file projects, uploaded images, and datasets are out of scope for this MVP.
- PDF preview uses browser-native embedding, not full PDF.js annotation tools.
- Runtime/package expansion and a future subscription release are tracked in [ROADMAP.md](ROADMAP.md).
- Authentication is a single bearer token and Tailscale boundary; production public deployment requires a more complete identity/access model and TLS.
- When editing rapidly, only one compilation is sent at a time; rapid edits may temporarily leave the last successful PDF visible until another build.
- No direct file management of uploaded PDFs or multiuser collaboration yet.

## Reproducible build

`package-lock.json` is committed. CI and both Docker images use `npm ci` to install pinned dependencies.
