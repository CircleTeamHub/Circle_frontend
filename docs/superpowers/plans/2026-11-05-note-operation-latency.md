# Note operation latency implementation plan

**Goal:** Reduce unnecessary request bytes, serial reads and synchronous client work when creating or collecting a note, preserving publication recovery and private card rules.

**Evidence:** Production create/collect samples were about 112/122 ms; no database pool wait was observed. Local synthetic rich-text reconciliation previously took about 185 ms and the maximum styled fixture sent about 3961 KiB with duplicated text blocks. Exact historical two-to-three-second client waits remain unrecorded.

- [x] Add failing tests for compact create/update bodies, structural reconciliation without serialization, bounded account-scoped collection lookup, and parallel restoration of missing chat context.
- [x] Compact redundant top-level text JSON only at the create/update API boundary; the server's structured text section remains authoritative. Keep pending snapshots unchanged.
- [x] Compare canonical note values directly instead of rebuilding/sorting/stringifying the entire rich-text tree; retain all replay checks.
- [x] Reuse a short-lived, mutation-invalidated, account-scoped full-list snapshot and deduplicate concurrent lookups of saved copies. Keep normal list refreshes uncached.
- [x] Run independent conversation/history restoration in parallel, retaining source validation and retry/account guards.
- [x] Memoize the editor render fingerprint across transient UI changes while invalidating it for changed text, block and ownership references; retain live snapshots for save/autosave/recovery.
- [x] Add note operation metrics to the existing privacy whitelist and source/request stage diagnostics for detail collection; cover both detail and chat-sheet collection entries.
- [x] Run focused Node/Jest behavior checks, typecheck, lint, payload/CPU benchmarks and diff checks; confirm temporary command processes exit.

## Validation

- Eight relevant Jest suites passed (259 tests); final API/comparison additions passed separately (11 tests across those two suites). These cover recovery, duplicate submissions, account changes, source permissions, snapshot expiry, mutation invalidation, and failed lookup release.
- Nine focused Node suites passed (97 tests), including canonical replay validation, draft recovery, pagination and telemetry privacy. Updated two obsolete source assertions that still required hiding every private card, contrary to the requested card visibility rules; screen behavior tests verify visibility.
- Typecheck, lint and scoped `git diff --check` passed. No dependencies, server changes or production writes.
- Desktop synthetic fixture benchmark, same VM loader and 12 measured iterations after warmup: ordinary body request 14.3→7.9 KiB; long plain 311.6→165.1 KiB; long styled 3948.3→1983.5 KiB. Reconciliation median: ordinary 0.31→0.15 ms; long plain 9.23→4.00 ms; long styled 173.51→117.40 ms. These are local CPU/payload measurements, not end-to-end phone timings.
- Production server samples and DTO read checks from the earlier investigation do not identify the complete historical 2–3 s wait. The changes require a new client release and a timed end-to-end production observation before claiming that historical delay is resolved.
- All temporary command sessions exited; no development server, tunnel or background helper was started.

No production writes, deployment, log export, new dependency or background service is required.
