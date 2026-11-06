# Media bandwidth cache implementation plan

> **For agentic workers:** Use subagent-driven-development for the independent image task; implement the shared video change in the coordinating session. Preserve the existing dirty workspace; do not commit unrelated work.

**Goal:** Reduce repeated media downloads in the mobile app without eagerly downloading videos or persisting disappearing media.

**Architecture:** Reuse expo-image disk caching and expo-video's bounded, range-based native cache. Extend the installed expo-video via patch-package with an optional stable cache key, keeping the original signed network URI intact. Derive the video cache identity by excluding only COS/S3 authentication query parameters, retaining object versions and transformations. Web continues to use the browser cache.

**Tech Stack:** Expo SDK 55, expo-image 55, expo-video 55.0.15, TypeScript, Jest, patch-package.

## Global constraints

- Preserve all existing uncommitted work; do not commit, deploy, or change cloud settings.
- No new dependencies or full-file download cache.
- Disappearing chat videos must not use persistent video caching.
- Local picker/file/blob sources remain local and do not use the network cache.
- Keep the network URL and its authentication parameters unchanged.
- Use existing native cache eviction; image cache gains must not weaken disappearing-image protections.

## Task 1: Images and viewer demand loading

Files: `src/features/discover/components/image-grid.tsx`, `src/features/discover/components/moment-media.tsx` (image source/rendering only), `src/features/discover/screens/MomentDetailScreen.tsx` (comment image cache policy), `src/features/notes/components/NoteCard.tsx`, `src/components/ui/image-viewer.tsx`, corresponding specs.

- [x] Add failing component tests for disk-backed feed thumbnails, stable keys for mixed-feed images/posters and note covers, and loading only the current full-size image.
- [x] Verify the new tests fail before the implementation.
- [x] Set ordinary thumbnails/posters to `memory-disk`, retain or supply stable per-variant keys, avoid a remote preview placeholder fetching a larger image alongside a thumbnail, and use note cover media ID plus note ID for the cover key.
- [x] Only mount the active ZoomableImage; keep swipe navigation placeholders and privacy behavior.
- [x] Run the focused component tests and report exact changed files and results.

## Task 2: Persistent video caching across signed URLs

Files: new `src/utils/video-source.ts` and tests; the chat, moment, and note video viewers; `patches/expo-video+55.0.15.patch`; native expo-video records and cache plumbing represented by that patch.

- [x] Write failing tests for remote caching, local/ephemeral exclusion, unchanged authenticated URI, stable cache identity across COS/S3 signature refreshes, and distinct identity for another object/version.
- [x] Update viewer tests to require cached source objects for ordinary media and an uncached source for disappearing chat videos.
- [x] Add optional `cacheKey` native field: Android passes it to MediaItem's custom cache key; iOS hashes it for video and media-info cache paths, including cached MIME lookup.
- [x] Supply the shared source object at all three playback entry points. Keep lazy playback and existing cleanup/error handling.
- [x] Generate and validate the patch against the exact installed package, and document the native rebuild requirement.

## Task 3: Verification and review

- [x] Run targeted behavior suites with a writable cache directory and `--roots src` to avoid nested checkout collisions.
- [x] Run TypeScript, lint, the source tests, and the behavior suite; distinguish unrelated existing failures.
- [x] Review the task-only changes against the starting workspace snapshot, focusing on cache identity, privacy, and playback cleanup.
- [x] Verify any started test/build processes exit. No servers are needed.

## Progress

- Implementation and source review complete. No commits, cloud changes, or releases performed.
- Privacy review fixes: wait for native players to release before clearing video caches; persist the policy marker only after both cache clears succeed; treat a missing native cache directory as a successful empty cache. COS temporary-token rotation is also excluded from cache identity.
- Full behavior verification: 186 suites / 1,608 tests passed. App/source TypeScript and ESLint passed using the installed tools directly. The npm Expo wrappers have missing Windows command shims, and the unscoped TypeScript command includes unrelated nested test-results checkouts.
- All 23 focused source/build tests passed. The full source-test run had 3,596 cases with 18 unrelated failures in existing source assertions and Windows Bash/build harnesses; those files were left unchanged.
- Native patch parsing, reverse application against the installed package, and forward application against pristine package sources passed. Android `:expo-video:compileDebugKotlin` passed with a single-use Gradle daemon and in-process Kotlin compilation.
- Temporary test/build processes have exited, including the five single-use Gradle daemons used during verification. No development servers were started.
- iOS native compilation, installed-device behavior, and the percentage of bandwidth saved remain unverified. A new native build is required; no APK/IPA was generated or published.
