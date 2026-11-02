# Patex — SL Labs scientific writing workspace

Write prose, LaTeX mathematics, citations, and executable analysis in one document, with a PDF beside it. Patex is a TypeScript/React browser application with a Node API and disposable Debian-based document workers. The browser supports macOS, Windows, and Linux; Linux with Docker and user systemd runs the isolated production worker.

Patex is a private research pilot. Public subscription launch still needs an operator-owned domain and TLS, billing, account recovery, operational review, and demand validation. See [PILOT-ACCEPTANCE.md](PILOT-ACCEPTANCE.md) for measured acceptance and [TODO.md](TODO.md) for remaining work.

## Writing

- Source and PDF start at 50/50. Collapse Projects, use Focus, or drag the divider; double-click it to restore equal widths. Keyboard labels use Ctrl/Cmd.
- Native TeX, R Markdown, and Quarto are first-class documents. Rmd keeps R chunks, inline R values, plots, tables, prose, and math together. Python through reticulate and Node chunks also run inside Rmd. [One-file example](examples/one-file-math-stats.Rmd).
- Import a ZIP or folder with its original paths, helpers, data, figures, bibliography, and lockfiles. Choose the main document; source bytes are preserved. Dependency caches such as `node_modules`, `.venv`, and `renv/library` are skipped.
- The project tree opens supporting text files and downloads binary files. Add files or folders, export the complete project ZIP, restore a revision, or archive/restore a project.
- Autosave and delayed PDF builds keep the last successful output visible on errors. New builds supersede older ones. Manual Compile (Ctrl/Cmd+Enter) recomputes results.
- Identical builds reuse the PDF. Pure-R Rmd documents can reuse analysis after prose edits; code, data, helper, YAML, or worker-image changes invalidate that cache. Mixed Python/Node documents recompute. Cache storage is bounded to 8 MB and is an optimization, not a reproducibility guarantee. Use manual Compile for a fresh result or time-dependent/external analysis.
- PDF.js provides selectable text, page controls, zoom, and retained page position. Native TeX offers Find in PDF and Ctrl/Cmd+click back to source using SyncTeX. Rmd/Qmd source navigation is still pending.
- `references.bib` plus additional `.bib` files, citation-key and label completion, unresolved-reference warnings, BibTeX/Biber, article/AMS/IEEE templates, and pdflatex/xelatex/lualatex support publishing workflows. Follow the target journal's instructions.

## Offline mathematics library

Open **∑ Library** to search 32 expressions covering fractions, sums, calculus, matrices, probability, and statistics. Each entry has a rendered preview, source, usage note, and inline/display insertion. Tab and Shift+Tab move through editable fields. Type a LaTeX command or press Ctrl+Space for local completion.

Local math checks flag common command misspellings and unbalanced delimiters, with fixes for known typos. How-to notes cover grouping, symbols, equation numbering, and citations. These features work without AI or an external connection; they check syntax, not mathematical correctness or statistical assumptions.

## Deploy on a Linux Docker host

```bash
cp .env.example .env
# Set a private random PATEX_ACCESS_TOKEN, public URL, MCP hosts, optional AI credentials.
# openssl rand -hex 32
docker build -f infra/Dockerfile.compiler -t patex-runner .
bash scripts/install-worker.sh patex-runner
# Put the printed PATEX_WORKER_DIR in .env.
docker compose -f compose.yml up -d --build app
curl http://127.0.0.1:4318/api/health
docker exec patex-app node dist/node/server/manage.js owner-invite samuel
```

Open the one-use owner invitation privately and set a password in Account settings. Invitations expire after 24 hours; sessions after seven days. The owner retains pre-existing projects. Invite researchers from Account settings; each receives a separate workspace. Disabling an account immediately blocks its sessions and API tokens. API tokens expire after 30 days. Keep the master token for trusted operator scripts only.

The host worker pins the built image digest. Re-run `install-worker.sh` after upgrading the runner. It needs Docker access on the trusted host; the web app receives only a narrow Unix socket, never the Docker socket. Enable user-service persistence with your system administrator if the machine has no lingering user session.

The app binds localhost port 4318. Put Nginx in front using [infra/nginx-patex.conf.example](infra/nginx-patex.conf.example). **Forward browser cookies and Authorization unchanged; never inject the master bearer token at the proxy.** Allow 32 MB uploads and at least 180 seconds for worker requests. Set `PATEX_COOKIE_SECURE=true` behind HTTPS. Private `.sl` names require Tailscale and client hostname configuration; the separate private infrastructure repository manages those routes.

### Isolation and limits

Each compile, script, or navigation operation gets a fresh non-root container with no network, no host/app-data mounts, read-only root filesystem, dropped capabilities, 768 MB temporary storage, 1.5 GB RAM, two CPU cores, and 128 processes. The broker allows two simultaneous jobs and a queue of 12; document jobs time out after 150 seconds. Native TeX disables shell escape. Cancellation destroys the entire job container.

A project permits 500 files / 64 MB total, 8 MB per supporting file, 1 MB main source, and a 24 MB PDF; ZIP upload is limited to 32 MB compressed. The private pilot permits 30 accounts and 50 projects per workspace, including archives. HTTP compute and AI requests have hourly workspace limits. This is a bounded single-host pilot, not a claim of completed public-hosting security certification.

The image includes Node 22, Debian Python with NumPy/SciPy/pandas/matplotlib/SymPy, R with knitr/rmarkdown/reticulate/codetools/here/ggplot2/dplyr, Quarto, latexmk, BibTeX/Biber, and TeX Live. The worker image digest is recorded with builds and exports. Package installation is an explicit image change: jobs cannot download dependencies. Imported lockfiles are preserved, not automatically installed. Node supports its own erasable TypeScript syntax; a complete TypeScript project toolchain and shared state across separate Node chunks remain pending.

### Backups and recovery

```bash
bash scripts/backup.sh                  # private snapshot + SHA256
bash scripts/install-backups.sh         # user systemd timer, daily around 03:00
systemctl --user list-timers patex-backup.timer
```

Backups contain projects, assets, history, PDFs, accounts, and hashed credentials. Store them privately and copy them off-host. The backup script briefly pauses the app to snapshot consistent files; it unpauses on failure. Restore the archive into an empty Docker volume mounted at `/data`, then start the matching app/worker images. Keep the old volume intact until recovery has been verified. Backups currently require operator-managed retention and off-host copies.

## AI and MCP

Local completion and builds work while AI is disabled or unavailable. Optional AI inline suggestions appear at the cursor; Tab accepts and Escape dismisses. The side assistant can revise a selection or propose a document change. Review its diff before Apply; stale suggestions cannot overwrite later edits. Requests can be cancelled. Provider connection tests report real errors and latency.

Set explicit provider API credentials; Patex does not inherit ChatGPT or Claude web subscriptions or their tools.

- `LLAMAFARM_CHAT_URL`: full OpenAI-compatible `/v1/chat/completions` URL; `LLAMAFARM_MODEL`: the actual served model identifier. `/mcp` is a separate protocol.
- `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` for Claude.
- `OPENAI_API_KEY` and `OPENAI_MODEL` for OpenAI.

AI decisions can optionally be recorded per project, reviewed, exported, and deleted. Capture is off by default. Patex does not send private work into a training pipeline. Later human corrections and consented model evaluation remain future work.

Patex exposes project tools over Streamable HTTP `POST /mcp`. Create a scoped MCP/API token in Account settings and send `Authorization: Bearer <token>`. Add the actual hostname to `PATEX_MCP_ALLOWED_HOSTS`. The tools operate only in that account's workspace. Trusted operator stdio access is also available through `docker exec -i patex-app node dist/node/server/mcp-stdio.js`; stdio has owner-level storage access and must stay trusted. The editor's AI calls chat APIs; arbitrary external MCP-tool consumption by the chat panel remains pending.

## Development and checks

```bash
npm ci --no-audit --no-fund
npm run dev:compiler  # local trusted development only; needs native runtimes
npm run dev           # API 3000, browser 5173
npm run verify        # strict TypeScript, ESLint, Jest, production build
npm run test:coverage
```

Vite proxies `/api`, `/auth`, and `/mcp` to `PATEX_DEV_API` (default `http://127.0.0.1:3000`). For isolated development, point the API at the host worker socket instead of the legacy HTTP compiler. The HTTP compiler is retained for trusted local development, not production untrusted jobs.

`package-lock.json` is committed and images use `npm ci`. CI runs verification and coverage; SonarQube scanning runs when `SONAR_TOKEN` and `SONAR_HOST_URL` are supplied. Source-bundle manifests include file hashes, the selected main document and engine, and the worker image digest when compiled. Exported build notes describe rebuilding outside Patex.
