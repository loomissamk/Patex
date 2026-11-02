# Patex roadmap

## Next: executable research code

- [ ] Add R, Python, and JavaScript files to a project with editor tabs and syntax support.
- [ ] Run code in separate, resource limited workers with no host credentials or Docker socket access. Set time, memory, process, filesystem, and network limits before enabling execution.
- [ ] Capture stdout, errors, plots, tables, and generated files as project artifacts. Let users insert selected artifacts into `main.tex` and refresh the PDF.
- [ ] Pin reproducible runtime and package versions. Decide which packages can be installed per project and how datasets are uploaded.
- [ ] Add language specific tests using real generated plots and LaTeX builds.

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
