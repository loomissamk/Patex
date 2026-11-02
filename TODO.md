# Patex: human → source → reproducible PDF

Patex is a browser workspace for people writing mathematics and scientific work. The document is the center: prose, equations, citations, executable analysis, results, and figures live in reading order, while the PDF refreshes beside the source. AI helps the author write and fix the document; the human owns every change and the final publication.

## Build order and acceptance checks

### Working branch milestone

- [x] Preserve old TeX project data while adding `main.Rmd` and `main.qmd` project formats and source tabs.
- [x] Render R chunks, inline R values, mathematics, and an R plot into a PDF in the V100 staging image.
- [x] Store `references.bib` and build a cited Rmd PDF and a cited native TeX PDF in staging.
- [x] Add opt-in local accepted/rejected AI feedback records with export and deletion APIs; no model-training transfer.
- [x] Verify browser creation/edit/preview and feedback controls against the staging app; confirm Rmd citation text in the generated PDF.
- [x] Deploy through Nginx; verify live Rmd and Qmd computed PDF text, resolve an Rmd citation, and preserve the existing homework PDF byte for byte.
- [x] Compile an existing single-file matrix homework unchanged; compile a substantial statistics homework after embedding its external R helper in a copy. Render a standalone mixed R/Python/typed Node/math/plot/citation example in staging and live Patex, and inspect both PDF pages.
- [x] Audit 30 active Matrix Theory and Statistics source files through the live compiler. Route `.Rmd` through native R Markdown for closer pagination; verify 18/19 Matrix files unchanged, 1/11 Statistics files unchanged, and all 10 remaining Statistics files as one-file copies with their shared helper embedded. Keep the detailed private audit outside this public repo.

### 1. Document-first authoring

- [ ] Keep existing `main.tex` projects working unchanged. Add `main.Rmd`/`main.qmd` documents as first-class project sources; import the user's existing files without silently rewriting them.
- [ ] Render R/R Markdown code chunks, inline values, LaTeX math, raw LaTeX results, plots, tables, and prose in source order. Start with a real Stats Methods Rmd fixture modeled on the existing homework workflow.
- [ ] Detect inline-only Qmd engine requirements and either choose the correct engine from its inline language or show a clear build diagnostic. Quarto currently leaves an R inline expression literal when the document has neither a code cell nor explicit `engine: knitr`.
- [ ] Make the tested Python and Node chunks a reliable product feature: pin the exact runtimes, test repeated chunks and shared state, support a complete TypeScript toolchain, and provide an explicit path for sharing data across languages.
- [ ] Keep the source/PDF split at 50/50 by default. Build after a short typing pause, cancel or supersede stale builds, keep the last good PDF, preserve preview position, and show errors at their source lines. Long code cells need an explicit run control and cache/freeze options.
- [ ] Allow a project to contain supporting source, images, data, and generated artifacts without making separate script tabs the primary writing flow.
- [ ] Import an existing multi-file Rmd project with sourced R helpers, data, and its declared packages. The current compiler cannot render such a project unchanged from a single source upload.
- [ ] Import an existing TeX project with its figures and subdirectories. The citation-audit source still needs its external PNG folder.

### 2. Publishing essentials

- [ ] Add `.bib` files, cite-key completion, unresolved-citation diagnostics, and BibTeX/Biber/CSL options. Use a build driver that resolves references and citations completely.
- [ ] Support labels and cross references for equations, figures, tables, and sections; figure/table captions; multiple source files; common journal classes and templates; and selectable PDF engines.
- [ ] Export PDF plus a clean, portable source bundle (`.tex`/`.Rmd`/`.qmd`, `.bib`, figures, data manifest, dependency lockfiles, build instructions). Test by rebuilding the export on a clean machine.
- [ ] Add source and output checks: missing assets, undefined references, bad citation keys, overfull boxes, and reproducibility warnings.

### 3. Human-directed AI

- [ ] Offer inline completions and targeted actions on a selection or build error. Show a diff before applying any proposed change; include the exact project files and diagnostics in context with user control.
- [ ] Connect user-chosen local or remote providers and MCP tools with clear status, permissions, latency, and cancellation. Editing and PDF builds must remain usable when AI is offline.
- [ ] Record an **opt-in** feedback event when a person accepts, edits, or rejects an AI suggestion. Store source revision, proposed diff, human correction, and build outcome locally; redact secrets and permit review, export, and deletion. Never use private work for model training without explicit consent.
- [ ] Build a consented evaluation set from those events and measure citation correctness, compile success, mathematical preservation, and human edit distance before changing prompts or models.

### 4. Reliable private beta, then subscription

- [ ] Isolate each untrusted code run from the app and network with CPU, memory, process, time, and storage quotas. Pin runtimes and dependencies; capture provenance for every PDF.
- [ ] Add project history, backups, recovery, cross-browser and accessibility tests, and an end-to-end test using both an Rmd and a native TeX document.
- [ ] Add project archive/delete and restore controls so users can clear the workspace without server filesystem access.
- [ ] Before public signups: user and organization identity, project permissions, TLS, audit logs, abuse controls, billing, support, and a security review. Validate demand with researchers using real manuscripts.

## Current baseline

The prior deployed build auto-compiles `main.tex` after a 2.4-second pause and has separate R, Python, and JavaScript tabs with manual artifact insertion. This milestone adds the first literate-document, bibliography, and feedback slice. The full publishing and consented evaluation workflow above remains open until the source export, isolation, and remaining document checks pass.
