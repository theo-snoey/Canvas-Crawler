## Implementation Checklist (Sequential)

Use these steps in order. Each step has clear outcomes so work can be verified before moving on.

### Phase 0 – Project bootstrap
- [ ] Create repository and basic folder layout (`extension/`, `docs/`, `fixtures/`).
- [ ] Choose Canvas host(s) and record in config.
- [ ] Decide on initial settings: sync frequency, ghost‑tab concurrency, file extraction mode.

### Phase 1 – MV3 scaffold
- [ ] Create `manifest.json` with required `permissions` and `host_permissions`.
- [ ] Add service worker (`src/background/serviceWorker.ts`).
- [ ] Add minimal popup (`src/popup`) and options page (`src/options`).
- [ ] Wire build tooling (Vite/Rollup/ESBuild) and dev reload.
- [ ] Acceptance: extension installs and background logs hello world.

### Phase 2 – Auth probe and login flow
- [ ] Implement startup listener (`onStartup`, `onInstalled`).
- [ ] Implement auth probe via `fetch` to Canvas root with `credentials: 'include'`.
- [ ] If unauthenticated, show notification and open pinned login tab; listen for dashboard detection.
- [ ] Acceptance: after manual login, crawler resumes automatically.

### Phase 3 – Storage layer foundation
- [ ] Wrapper for `chrome.storage.local` with schema versioning and migrations.
- [ ] `IndexedDB` setup with stores: `htmlSnapshots`, `structured`, `blobs`, `extractedText`.
- [ ] Utility for content hashing and compression (e.g., `pako`).
- [ ] Acceptance: can write/read large payloads and migrate schema v0 → v1.

### Phase 4 – Crawl queue and scheduler
- [ ] Implement prioritized work queue with persistence (resume after restart).
- [ ] Concurrency controls (e.g., 4–6 tasks, 1–2 ghost tabs limit).
- [ ] Retry with exponential backoff and jitter; 429 handling.
- [ ] `chrome.alarms` periodic wake (e.g., hourly).
- [ ] Acceptance: queue processes mock tasks reliably across restarts.

### Phase 5 – Fetch‑first page loader
- [ ] Network `fetch` helper with cookies, redirects, and error normalization.
- [ ] Conditional requests with ETag/Last‑Modified; local cache integration.
- [ ] HTML parsing with `DOMParser` and sanitization (strip scripts/styles).
- [ ] Acceptance: can fetch and parse dashboard HTML into a DOM.

### Phase 6 – Ghost‑tab subsystem
- [ ] Manager to create minimized/inactive tabs and inject content scripts.
- [ ] Messaging protocol (request → scrape → response) with timeouts and aborts.
- [ ] Page‑ready detector and UI automation helpers (expanders, pagination, lazy loads).
- [ ] Acceptance: can open a course page in a background tab, expand content, and return HTML.

### Phase 7 – Course discovery
- [ ] Parser: dashboard → list of courses (id, name, code, URL).
- [ ] Store `StudentIndex` and per‑course index shell.
- [ ] Acceptance: course list persists and dedupes across runs.

### Phase 8 – Section list crawlers
- [ ] Announcements list parser (fetch‑first, fallback to ghost tab if needed).
- [ ] Assignments list parser.
- [ ] Discussions list parser (handles pagination).
- [ ] Pages list parser.
- [ ] Files metadata list parser (no downloads yet).
- [ ] Quizzes list parser (metadata only).
- [ ] Modules list parser.
- [ ] Grades overview scraper (metadata and expanders where visible).
- [ ] People roster scraper.
- [ ] Syllabus page scraper.
- [ ] Acceptance: for a test course, all lists populate with stable IDs and URLs.

### Phase 9 – Detail page crawlers
- [ ] Announcements detail (full HTML, attachments, comments).
- [ ] Assignments detail (description, rubric, attachments, feedback links).
- [ ] Discussions detail (topic + full thread; expand all).
- [ ] Pages detail (HTML content).
- [ ] Files item (metadata; defer downloads unless configured immediate).
- [ ] Quizzes detail (instructions only unless questions are visible).
- [ ] Modules item resolution (follow links for Canvas‑internal resources).
- [ ] Grades detail (per‑assignment comments/feedback where visible).
- [ ] Acceptance: all detail records tie back to list items by `(courseId, collection, itemId)`.

### Phase 10 – Files pipeline
- [ ] Add file download worker with concurrency limits and retry.
- [ ] PDF.js integration to extract text from PDFs into `extractedText`.
- [ ] Tesseract.js worker for image OCR (configurable, off by default).
- [ ] Blob de‑duplication by content hash; optional storage of bytes vs text only.
- [ ] Acceptance: sample PDF and image produce stable extracted text entries.

### Phase 11 – Incremental sync
- [ ] Per‑URL ETag/Last‑Modified storage and conditional requests.
- [ ] Normalized HTML hashing to skip unmodified parses.
- [ ] Targeted recrawl planner using change signals from lists.
- [ ] Acceptance: subsequent runs are significantly faster; unchanged items are skipped.

### Phase 12 – Status UI
- [ ] Extension page: queue status, recent changes, error log, manual rescan.
- [ ] Simple course browser to verify captured data exists locally.
- [ ] Acceptance: user can see progress and open stored items quickly.

### Phase 13 – Privacy and safety
- [ ] Local purge button (wipe `IndexedDB`/`storage.local`).
- [ ] Optional encryption at rest (WebCrypto, PIN‑derived key) for blobs and text.
- [ ] Document what is collected and not collected (readme section).
- [ ] Acceptance: opt‑in encryption works and data is unrecoverable after purge.

### Phase 14 – Robustness and performance
- [ ] Tune concurrency and backoff; protect CPU during browser startup.
- [ ] Tab/resource watchdogs and memory caps for offscreen/ghost tabs.
- [ ] Structured logging with rotating buffer persisted locally.
- [ ] Acceptance: passes long‑run soak (8+ hours) without leaks or crashes.

### Phase 15 – Testing
- [ ] Unit tests for parsers using saved HTML fixtures per section.
- [ ] Integration smoke run against a test account; capture timing and coverage.
- [ ] Regression tests using frozen fixtures to detect selector drift.
- [ ] Acceptance: CI passes unit suite; manual run meets coverage/time targets.

### Phase 16 – Packaging and configuration
- [ ] Build production bundle; validate MV3 rules.
- [ ] Config system for Canvas hostnames and feature flags.
- [ ] Signing/packing instructions for distribution.
- [ ] Acceptance: installable production CRX/zip with documented config.

### Phase 17 – Documentation and handover
- [ ] `docs/` with architecture, data model, and operations (sync, purge, backup).
- [ ] User guide for first‑run login and permissions.
- [ ] Developer guide for extending parsers and adding institutions.
- [ ] Acceptance: new developer can set up and run the project in under 30 minutes.


