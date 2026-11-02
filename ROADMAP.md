# Patex roadmap

## Executable research code

- [x] Add JavaScript, Python, and R source tabs with syntax support.
- [x] Run scripts in the compiler container with time, output, and artifact limits; capture console output and generated files.
- [x] Insert generated TeX snippets and images into `main.tex` and rebuild the PDF.
- [ ] Move arbitrary code execution to a fresh, isolated per-run worker with no network path to the app, a stricter process/filesystem policy, and independent quotas. The current shared container is for private use only.
- [ ] Pin reproducible runtime and package versions. Decide which packages can be installed per project and how datasets are uploaded.
- [x] Test all three runtimes and compile a generated R plot to PDF in the V100 Docker image.
- [ ] Add dataset upload, dependency management, and richer outputs such as interactive tables.

## AI and MCP

- [ ] Measure LlamaFarm completion latency under concurrent GPU jobs; use a small dedicated completion model or queue if the shared 27B model cannot respond quickly.
- [ ] Add model health and response time to Connections. Provider configuration alone is not a live health check.
- [ ] Add scoped MCP client connections for external tools and a permission view. Patex currently exposes its own MCP project tools; its editor does not call LlamaFarm's MCP tools directly.
- [ ] Add per project AI preferences and a visible on/off switch for automatic inline suggestions.

## Subscription product

- [ ] Add user accounts, organization/project permissions, and isolated per customer project storage.
- [ ] Add HTTPS, backups, recovery, audit logs, rate limits, and a security review of document compilation and code execution.
- [ ] Define plans, metered usage and quotas for compilation and AI, billing, trial flow, and cancellation/export.
- [ ] Test onboarding, accessibility, cross browser behavior, uptime monitoring, and support paths before public launch.
