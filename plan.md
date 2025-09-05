# Canvas Scraper Implementation Plan

## Overview
This document outlines the step-by-step implementation plan for the Canvas Ghost-Tab Scraper Chrome extension. Each phase builds upon the previous one, with clear acceptance criteria for completion.

## Phase Status

### Phase 0 – Project Setup ✅
- [x] Repository initialization and basic structure.
- [x] Documentation (README, setup guide, architecture overview).
- [x] Configuration templates and examples.
- [x] Acceptance: project structure exists, can clone and run basic setup.

### Phase 1 – Extension Foundation ✅
- [x] Chrome extension MV3 manifest with permissions and host permissions.
- [x] Service worker with basic startup and message handling.
- [x] Content script for DOM interaction.
- [x] Popup UI with status display and basic controls.
- [x] Options page for configuration management.
- [x] Build system with Vite and TypeScript.
- [x] Acceptance: extension loads in Chrome, shows popup, handles basic messages.

### Phase 2 – Enhanced Auth Probe and Login Flow ✅
- [x] Config manager for Canvas hosts and settings persistence.
- [x] Auth manager with dual approach (API check + page content check).
- [x] Login detection and automatic crawl resume.
- [x] Enhanced error handling and fallback strategies.
- [x] Acceptance: detects authentication status reliably, prompts for login when needed.

### Phase 3 – Storage layer foundation ✅
- [x] Wrapper for `chrome.storage.local` with schema versioning and migrations.
- [x] `IndexedDB` setup with stores: `htmlSnapshots`, `structured`, `blobs`, `extractedText`.
- [x] Utility for content hashing and compression (e.g., `pako`).
- [x] Acceptance: can write/read large payloads and migrate schema v0 → v1.

### Phase 4 – Crawl queue and scheduler ✅
- [x] Implement prioritized work queue with persistence (resume after restart).
- [x] Concurrency controls (e.g., 4–6 tasks, 1–2 ghost tabs limit).
- [x] Retry with exponential backoff and jitter; 429 handling.
- [x] `chrome.alarms` periodic wake (e.g., hourly).
- [x] Acceptance: queue processes mock tasks reliably across restarts.

### Phase 5 – Fetch‑first page loader
- [x] Network `fetch` helper with cookies, redirects, and error normalization.
- [x] Conditional requests with ETag/Last‑Modified; local cache integration.
- [x] HTML parsing with `DOMParser` and sanitization (strip scripts/styles).
- [x] Acceptance: can fetch and parse dashboard HTML into a DOM.

### Phase 6 – Ghost‑tab subsystem
- [x] Manager to create minimized/inactive tabs and inject content scripts.
- [x] Messaging protocol (request → scrape → response) with timeouts and aborts.
- [x] Page‑ready detector and UI automation helpers (expanders, pagination, lazy loads).
- [x] Acceptance: can open a course page in a background tab, expand content, and return HTML.

### Phase 7 – Course discovery ✅
- [x] Parser: dashboard → list of courses (id, name, code, URL).
- [x] Store `StudentIndex` and per‑course index shell.
- [x] Acceptance: course list persists and dedupes across runs.

### Phase 8 – Section list crawlers ✅
- [x] Announcements list parser (fetch‑first, fallback to ghost tab if needed).
- [x] Assignments list parser.
- [x] Discussions list parser (handles pagination).
- [x] Pages list parser.
- [x] Files metadata list parser (no downloads yet).
- [x] Quizzes list parser (metadata only).
- [x] Modules list parser.
- [x] Grades overview scraper (metadata and expanders where visible).
- [x] People roster scraper.
- [x] Syllabus page scraper.
- [x] Acceptance: for a test course, all lists populate with stable IDs and URLs.

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

### Phase 10 – Files pipeline ✅
- [x] Add file download worker with concurrency limits and retry.
- [x] PDF.js integration to extract text from PDFs into `extractedText`.
- [x] Tesseract.js worker for image OCR (configurable, off by default).
- [x] Blob de‑duplication by content hash; optional storage of bytes vs text only.
- [x] Acceptance: sample PDF and image produce stable extracted text entries.

### Phase 11 – Incremental sync ✅
- [x] Per‑URL ETag/Last‑Modified storage and conditional requests.
- [x] Normalized HTML hashing to skip unmodified parses.
- [x] Targeted recrawl planner using change signals from lists.
- [x] Acceptance: subsequent runs are significantly faster; unchanged items are skipped.

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
- [ ] User guide with screenshots and troubleshooting.
- [ ] Developer guide for extending parsers and adding new Canvas features.
- [ ] Performance tuning guide and monitoring recommendations.
- [ ] Acceptance: new developer can understand architecture and add features.

## Notes
- Each phase should be tested thoroughly before moving to the next.
- Phases can be worked on in parallel where dependencies allow.
- Regular commits and documentation updates throughout development.


