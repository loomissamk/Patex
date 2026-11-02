# Patex pilot acceptance

This branch addresses complete research projects, dependable PDF builds, publishing tools, reviewed AI edits, and separate pilot accounts. A checkbox means the check actually ran successfully.

- [x] Local strict TypeScript checks, ESLint, unit/integration tests, and production browser build.
- [x] Import the 30 original coursework sources with their real helpers/figures, without rewriting the sources.
- [x] Export each project, import it into a fresh workspace, and rebuild the exported files.
- [x] Confirm each code job has no network, no app/data/host mounts, bounded resources, and full cancellation cleanup.
- [x] Confirm prose edits reuse safe R analysis caches, code/data changes invalidate caches, and a manual build recomputes results.
- [x] Confirm last-good PDF, error locations, native TeX source/PDF navigation, and page preservation in the browser.
- [ ] Confirm citation-key completion, unresolved-reference warnings, templates, and PDF engine selection.
- [x] Confirm offline expression search, snippet insertion/Tab fields, and local math syntax checks with AI disabled.
- [ ] AI provider and reviewed-diff acceptance: deferred at the owner's request; the owner will check AI later.
- [x] Confirm separate users cannot read, edit, compile, export, or restore another workspace; revoke a guest and verify access stops.
- [x] Create and restore a full backup into a fresh volume; enable scheduled private backups.
- [x] Deploy the tested branch, back up existing data, remove proxy-wide owner authentication, and verify live service health.

Public subscription launch also requires an operator-owned public domain/TLS setup, payment-provider configuration, and paid demand validation. These are deployment/business inputs, not evidence supplied by passing a local test suite.

Evidence (2026-11-02): 35 tests across 9 Jest suites; strict TypeScript, ESLint, production build. Private coursework audit: 30 original imports and 30 exported-bundle rebuilds passed with unchanged original main-source hashes. Browser acceptance: real PDF text under production CSP, create/edit/compile, 50/50 focus, retained PDF page, offline fraction insertion and Tab fields, math typo warning, history, ZIP export/import; zero AI requests. Runtime checks: no network/app data/Docker socket/credentials in job; cancellation leaves no job containers; native TeX SyncTeX in both directions. R timestamp analysis remained identical after prose edits and changed after manual/code rebuilds; build failure retained the previous PDF. Account checks rejected cross-workspace reads, edits, compiles, exports and restores; disabling a guest revoked session and API access. A private backup restored into a fresh volume and matched every archived file (796 files, 64 PDFs, 4 accounts). Publishing builds passed article/AMS/IEEE, XeLaTeX/LuaLaTeX, BibLaTeX/Biber and mixed R/Python/typed Node Rmd. Private artifact contents and user coursework are not committed here.

Live deployment: `patex.sl` passed browser source/computed-PDF/offline-library checks with zero AI calls. Anonymous project API access returned 401 after removing the proxy-wide owner credential. The isolated worker and daily backup timer are active; an immediate scheduled-service backup completed successfully. Existing homework source and PDF remain unchanged. Follow-up editor checks confirmed opening a saved project performs no writes or compilation, supporting-file edits autosave and rebuild the PDF, and switching away from a long R build cancels it and builds the newly selected document. Runtime limits and private pilot scope remain as documented in README.md.
