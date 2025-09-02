## Canvas Ghost‑Tab Scraper – Project Summary

### Objective
Build a Chrome Extension (MV3) that, on browser startup, silently crawls a signed‑in student’s Canvas account using background “ghost” tabs and fast authenticated HTML fetches. Extract nearly all course‑accessible information and store it locally for instant reuse. No reliance on official Canvas APIs.

### High‑level architecture
- **Service worker (background orchestrator)**: startup logic, auth probe, crawl queue, concurrency, throttling, retries, incremental sync, error handling.
- **Fetch‑first crawler**: uses `fetch` with `credentials: 'include'` and `DOMParser` when HTML is accessible via CORS; falls back to ghost tabs when client‑rendered or blocked.
- **Ghost‑tab manager**: opens minimized/inactive tabs and injects content scripts to extract DOM, expands lazy UI, handles pagination; closes tabs when done.
- **Content scripts**: DOM extraction for dynamic pages; robust selectors; message results to the service worker.
- **Offscreen document**: headless environment to run heavy parsers (PDF.js, OCR via Tesseract) and DOM utilities without UI.
- **Storage layer**: `chrome.storage.local` for indexes/metadata/state; `IndexedDB` for large structured payloads and blobs; `CacheStorage` for HTTP revalidation and de‑duplication.
- **Optional UI**: simple status page (extension page) to show sync progress, errors, and to trigger rescans; minimal popup.

### Permissions and hosts
- `permissions`: `storage`, `tabs`, `scripting`, `cookies`, `alarms`, `notifications`, `offscreen`, `downloads`
- `host_permissions`: the Canvas hosts to target, e.g. `https://*.instructure.com/*` and/or institution‑specific Canvas domains
- Optional: `unlimitedStorage` depending on expected dataset size

### Startup and authentication flow
1. On `chrome.runtime.onStartup` and installation, perform an auth probe:
   - `fetch('https://<canvas>/')` with `credentials: 'include'`.
   - If redirected to login or login form detected, mark unauthenticated.
2. If unauthenticated: show notification and open a pinned, inactive tab to the Canvas login; detect dashboard load and resume.
3. If authenticated: start the crawl immediately.

### Crawl strategy (fast and thorough)
- **Fetch‑first**: try network `fetch` + `DOMParser` for list/detail pages.
- **Ghost‑tab fallback**: use when CORS blocks or content is client‑rendered or paginated.
- **Work queue**: prioritized BFS: dashboard → course indices → item details; concurrency 4–6; max 1–2 ghost tabs in parallel; jittered backoff on 429/5xx.
- **Incremental sync**: store ETag/Last‑Modified per URL and issue conditional requests; content hashing of normalized HTML to skip unchanged writes.
- **De‑duplication**: key items by `(courseId, collection, itemId, revision)`.
- **Scheduling**: full crawl on first run; thereafter quick scan of change signals; periodic `chrome.alarms` (e.g., hourly) for targeted updates.

### Coverage per course
- **Home**: all visible text, links, embedded summaries.
- **Announcements**: list and full detail pages, including attachments and comments.
- **Assignments**: list and details (title, description, due, points, rubric, submissions/feedback links, attachments).
- **Discussions**: topics and full threads; expand “load more” to capture all replies.
- **Grades**: overall and per‑assignment breakdown; expanders for comments/feedback.
- **People**: roster with roles; only what’s visible in DOM.
- **Pages**: list and individual content (published).
- **Files**: tree/list and metadata; optionally download for text extraction.
- **Syllabus**: full HTML, links, schedule tables.
- **Quizzes**: metadata and instructions; question content only if visible and permitted.
- **Modules**: all items (type, title, linked resource) and follow accessible links.
- **Collaborations / SCRIBE / Zoom / Panopto**: capture what Canvas exposes (LTI links/titles) and, if accessible, minimal metadata on target pages.

### Storage model
- **Indexes in `chrome.storage.local`**
  - `StudentIndex`: `{ courses: courseIds[], lastCrawl, version }`
  - Per‑course indexes of collections and item IDs with `etag`, `lastModified`, `lastHash`.
- **Payloads in `IndexedDB`**
  - `htmlSnapshots` by URL hash (normalized DOM without scripts/styles).
  - `structured` normalized JSON objects per item.
  - `blobs` for files when downloaded; `extractedText` for PDF/image OCR.
- **Size control**: keep last N snapshots, compress large text (e.g., `pako`), dedupe blobs by content hash.
- **Optional encryption**: encrypt sensitive payloads with WebCrypto using a user PIN‑derived key.

### Parsers and adapters
- CSS‑selector based extractors with resilient fallbacks.
- Content scripts auto‑expand accordions and paginate before capture.
- Unit test parsers against stored HTML fixtures to withstand markup changes.

### Performance tactics
- Prefer `fetch` + `DOMParser`; limit concurrent ghost tabs.
- Aggressive HTTP revalidation and local hashing to avoid re‑parsing.
- Batch writes to `IndexedDB`; stream parse where possible.
- Clean up tabs/resources immediately after extraction; memory guards.

### Privacy, security, and ethics
- Data stays local. No exfiltration.
- Respect institutional policies and Canvas ToS. Only scrape content visible to the logged‑in user.
- Clearly document what is captured; provide a one‑click purge.

### Minimal data schemas (guides)
```json
{
  "Course": { "id": 123, "name": "Biology 101", "code": "BIO101", "url": "https://.../courses/123" },
  "Assignment": { "courseId": 123, "id": 456, "title": "Lab 1", "dueAt": "2025-09-01T23:59:00Z", "points": 10, "descriptionHtml": "...", "attachments": [ { "name": "rubric.pdf", "url": "..." } ], "comments": [ { "author": "TA", "html": "..." } ] },
  "Discussion": { "courseId": 123, "id": 789, "title": "...", "bodyHtml": "...", "repliesHtml": "...", "lastReplyAt": "..." },
  "Announcement": { "courseId": 123, "id": 321, "title": "...", "html": "...", "postedAt": "..." }
}
```

### Risks and constraints
- **LTI boundaries** (Zoom, Panopto, Collaborations): often separate auth; plan to store link metadata and optional opt‑in scraping when reachable.
- **Quizzes**: question content may be protected; do not bypass controls.
- **Rate limits** and 429s: backoff and concurrency tuning.
- **Markup drift**: rely on stable attributes, maintain tested parsers, and keep fixtures up to date.

### Configuration knobs
- Target Canvas hostnames
- Concurrency limits for fetches and ghost tabs
- Immediate vs on‑demand file extraction
- Sync frequency (startup only, hourly, daily)
- Encryption at rest on/off

### Success metrics
- Time‑to‑first‑sync and time‑to‑incremental‑sync
- Coverage completeness per course section
- Local DB size and dedup efficiency
- Zero‑error runs across browser restarts


