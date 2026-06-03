# Circle IM Project Code Review Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:requesting-code-review for the review pass and superpowers:verification-before-completion before marking this plan complete. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review the full Circle IM frontend project for correctness, architecture drift, security, runtime lifecycle risks, test gaps, and maintainability issues.

**Architecture:** Treat this as a staged review, starting with reproducible project health checks, then moving from app entry points into feature modules and cross-cutting services. Findings should be written as actionable issues with file references, severity, impact, and a suggested fix; broad refactors should be split from bug fixes.

**Tech Stack:** Expo 55, React Native 0.83, Expo Router, TypeScript 5.9, Zustand, MMKV, OpenIM RN SDK, native WebSocket, i18next, Node test runner.

---

## Review Scope

**Primary code paths:**
- `app/`: Expo Router route definitions and navigation layout.
- `src/features/`: feature screens, feature stores, feature utilities, and domain components.
- `src/services/api/`: backend API wrappers, auth refresh, upload, and error handling.
- `src/services/auth/`, `src/components/app/session-bootstrap.tsx`: session restore, logout teardown, realtime and IM lifecycle.
- `src/im/`, `src/realtime/`: OpenIM SDK boundary, event listeners, WebSocket badge/profile/wallet events.
- `src/stores/`: global state, persistence contracts, reset behavior.
- `src/theme/`, `src/components/ui/`: shared design primitives and theme token usage.
- `src/i18n/`: locale loading, persisted language behavior, translation key coverage.
- `test/` and `src/**/*.test.mts`: current test coverage, test quality, and missing regression coverage.
- `README.md`, `api-integration.md`, `docs/superpowers/specs`, `docs/superpowers/plans`: documentation accuracy.

**Out of scope unless a finding requires it:**
- Backend implementation in `/Users/yiboding/projects/circle_be`.
- Visual redesign work.
- Large feature rewrites.
- User-owned dirty worktree changes unrelated to review findings.

## Review Output Format

Create or update a follow-up document after the review:

- `docs/reviews/YYYY-MM-DD-project-code-review-findings.md`

Each finding should use this format:

```markdown
### P1: Short title

**File:** `src/path/file.ts:123`
**Area:** auth | api | navigation | realtime | im | storage | ui | tests | docs
**Impact:** Concrete user or developer impact.
**Evidence:** What in the code proves the issue.
**Fix:** Smallest safe fix, with test expectation.
```

Severity guide:

- `P0`: crash, data loss, auth bypass, or impossible-to-use core flow.
- `P1`: likely production bug, token/session issue, broken navigation, stale realtime state, or serious test blind spot.
- `P2`: maintainability, performance, partial UX correctness, documentation drift.
- `P3`: minor cleanup, naming, comments, or local consistency.

## Task 1: Preserve Review Baseline

**Files:**
- Read: `package.json`
- Read: `tsconfig.json`
- Read: `README.md`
- Read: `api-integration.md`
- Read: `docs/superpowers/plans/*.md`
- Create later: `docs/reviews/YYYY-MM-DD-project-code-review-findings.md`

- [ ] **Step 1: Record working tree state**

Run: `git status --short --branch`

Expected: Output is captured in review notes. Do not revert or stage unrelated existing changes.

- [ ] **Step 2: Map project files**

Run: `rg --files -g '!*node_modules*' -g '!*.png' -g '!*.jpg' -g '!*.jpeg' -g '!*.gif' -g '!*.webp'`

Expected: Reviewer can identify app routes, feature modules, services, stores, tests, and docs.

- [ ] **Step 3: Capture high-risk large files**

Run: `find app src test -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mts' \) -print | xargs wc -l | sort -n | tail -40`

Expected: Review notes call out large screens/components that need extra attention, especially `src/features/chat/screens/ChatInfoScreen.tsx`, `src/features/chat/components/chat-bubble.tsx`, `src/im/client.ts`, `src/features/notes/screens/NotesScreen.tsx`, and `src/features/chat/screens/ChatDetailScreen.tsx`.

- [ ] **Step 4: Check documentation drift**

Compare `README.md` and `api-integration.md` against current code.

Expected: Review explicitly notes that `README.md` still describes the project as mocked/frontend-only while the code now includes backend API, OpenIM, realtime WebSocket, upload, MMKV migration, and production session flows.

## Task 2: Establish Automated Health Checks

**Files:**
- Read: `package.json`
- Read: `test/*.js`
- Read: `src/**/*.test.mts`
- Read: `tsconfig.json`

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`

Expected: PASS, or every TypeScript error is captured as a finding with the owning file and likely fix.

- [ ] **Step 2: Run Node test files**

Run: `node --test test/*.test.js`

Expected: PASS, or failures are triaged into product bug, brittle test, missing mock, or environment issue.

- [ ] **Step 3: Run TypeScript module tests**

Run each `.mts` test directly if the local Node/TypeScript setup supports it:

```bash
node --test src/features/discover/store/discover-state.test.mts
node --test src/features/discover/store/managed-circles.test.mts
node --test src/features/discover/utils/city-selection.test.mts
```

Expected: PASS, or document the missing loader/runtime prerequisite.

- [ ] **Step 4: Record missing project scripts**

Inspect `package.json`.

Expected: If there is still no `test`, `typecheck`, or lint script, add a P2 finding recommending explicit scripts so future reviews and CI use one stable command.

## Task 3: Review App Startup, Session, and Navigation

**Files:**
- Review: `app/_layout.tsx`
- Review: `app/index.tsx`
- Review: `app/(tabs)/_layout.tsx`
- Review: `app/(tabs)/**/_layout.tsx`
- Review: `src/components/app/session-bootstrap.tsx`
- Review: `src/services/auth/session.ts`
- Review: `src/stores/authStore.ts`

- [ ] **Step 1: Verify startup ordering**

Trace this sequence:

`migrateFromAsyncStorage()` -> store rehydrate -> language rehydrate -> `ThemeProvider` mount -> `SessionBootstrap` -> auth redirect.

Expected: No route renders with stale auth state, missing theme context, or stuck splash/loading state.

- [ ] **Step 2: Review logout teardown registration**

Check `registerLogoutHandler()` usage in `src/im/client.ts` and `src/realtime/client.ts`.

Expected: `clearLocalSession()` reliably disconnects IM/realtime after both modules have been evaluated; if module evaluation order can skip a handler, capture as a finding.

- [ ] **Step 3: Review navigation duplication**

Compare legacy route groups like `app/(chat)` with newer `app/(tabs)/messages/*` routes.

Expected: Any duplicate path wrappers are intentional, route redirects are stable, and no screen can be reached with incompatible params.

- [ ] **Step 4: Review auth redirect behavior**

Inspect `app/index.tsx`, login/register screens, and protected routes.

Expected: Authenticated users cannot remain on auth screens after login, unauthenticated users cannot enter protected flows, and loading states do not flicker between stacks.

## Task 4: Review API, Auth Refresh, and Upload Boundaries

**Files:**
- Review: `src/services/api/client.ts`
- Review: `src/services/api/auth.ts`
- Review: `src/services/api/upload.ts`
- Review: `src/services/api/errors.ts`
- Review: `src/constants/config.ts`
- Review: `test/auth-api.test.js`
- Review: `test/upload.api.test.js`
- Review: `test/config.api-url.test.js`

- [ ] **Step 1: Verify token refresh concurrency**

Review `refreshPromise`, 401 retry behavior, `retryOnAuthError`, and `clearLocalSession()` fallback.

Expected: Only one refresh runs during concurrent 401s, retried requests use the new token, and refresh failure cannot leave a partially authenticated store.

- [ ] **Step 2: Verify API response assumptions**

Check `readPayload()`, `isWrappedResponse()`, `unwrapResponse()`, and all API wrappers.

Expected: Empty responses, non-JSON responses, non-zero wrapped `code`, and HTTP errors produce predictable `ApiError` values.

- [ ] **Step 3: Review sensitive logging**

Check development logging in `src/services/api/client.ts` and chat logging in `src/features/chat/screens/ChatDetailScreen.tsx`.

Expected: Tokens, presigned URLs, message text, upload URLs, and personal data are not logged in a way that can leak during development builds or shared logs.

- [ ] **Step 4: Review upload platform behavior**

Check Android localhost handling, presigned PUT headers, content-type resolution, filename sanitization, and timeout behavior.

Expected: Native upload flows work on iOS and Android, large uploads have useful errors, and unsupported media cannot be uploaded through a weak client-side check alone.

## Task 5: Review IM and Realtime Lifecycle

**Files:**
- Review: `src/im/client.ts`
- Review: `src/im/listeners.ts`
- Review: `src/im/mappers.ts`
- Review: `src/realtime/client.ts`
- Review: `src/stores/imStore.ts`
- Review: `src/stores/tabBadgeStore.ts`
- Review: `src/stores/walletRealtimeStore.ts`
- Review: `test/im-client.test.js`
- Review: `test/im-client-chat-settings.test.js`
- Review: `test/realtime-client.test.js`
- Review: `test/tab-badge-store.test.js`
- Review: `test/tab-layout-badge.test.js`

- [ ] **Step 1: Verify OpenIM SDK initialization**

Review singleton init, data directory creation, listener binding before `initSDK`, unsupported platform behavior, and hot reload login handling.

Expected: SDK state cannot get stuck in connecting/initialized mismatch, and unsupported web usage fails predictably.

- [ ] **Step 2: Verify listener cleanup and duplication**

Trace `bindOpenIMListeners()` and `unbindAll`.

Expected: Listeners are not duplicated across hot reload/session recovery and are not accidentally unbound while the app still needs them.

- [ ] **Step 3: Verify ID mapping contracts**

Review `toImUserId()`, `fromImUserId()`, group IDs, user IDs, conversation IDs, and route params.

Expected: UUID hyphen stripping is applied only at SDK boundaries and never corrupts backend IDs.

- [ ] **Step 4: Verify realtime reconnect behavior**

Review WebSocket token query usage, reconnect backoff, recovery throttling, AppState reconnect, and event handling.

Expected: Token changes close old sockets, max reconnect behavior is observable, badge recovery does not overwrite current IM unread state, and no stale user receives another user's realtime events after logout/login.

## Task 6: Review Feature Modules

**Files:**
- Review: `src/features/auth/**`
- Review: `src/features/messages/**`
- Review: `src/features/chat/**`
- Review: `src/features/contacts/**`
- Review: `src/features/discover/**`
- Review: `src/features/notes/**`
- Review: `src/features/profile/**`
- Review: `src/features/search/**`
- Review: `src/features/social/**`
- Review: `src/features/user/**`

- [ ] **Step 1: Review auth screens**

Expected: Login/register validation, loading states, error handling, IM login fallback, and post-auth navigation are deterministic.

- [ ] **Step 2: Review messaging and chat screens**

Expected: `ChatDetailScreen`, `ChatInfoScreen`, share/transfer/history screens, group invite screens, and message composer flows handle missing params, failed network calls, upload failures, unread updates, and screen unmounts.

- [ ] **Step 3: Review contacts and user profile flows**

Expected: Friend request, remark/tag editing, activity unread markers, and user profile actions remain consistent for friend/non-friend/current-user cases.

- [ ] **Step 4: Review discover/circle flows**

Expected: Circle creation/editing, membership gates, city selection, filters, invitations, moment details, and notification settings share one domain model and reject invalid route state.

- [ ] **Step 5: Review notes editor**

Expected: DOM editor bridge, block formatting, edit/create/detail flows, offline-like failures, and cleanup timers are covered by tests or documented as risks.

- [ ] **Step 6: Review profile/settings/commerce flows**

Expected: Profile edit fields, avatar/cover upload, wallet, mall, member center, storage cleanup, language/theme settings, and permissions screens handle API failure and persisted state coherently.

## Task 7: Review State, Persistence, and Data Ownership

**Files:**
- Review: `src/storage/index.ts`
- Review: `src/stores/*.ts`
- Review: `src/features/**/store/*.ts`
- Review: `src/hooks/*.ts`
- Review: `test/*store*.test.js`

- [ ] **Step 1: Verify MMKV migration**

Expected: AsyncStorage migration is idempotent, does not drop legacy data before successful copy, and all persisted Zustand stores rehydrate after migration.

- [ ] **Step 2: Review reset semantics**

Expected: Logout resets all user-specific stores, realtime wallet state, message groups, badges, friend activity unread state, IM state, and any feature stores that hold private user data.

- [ ] **Step 3: Review store ownership**

Expected: Each piece of state has one source of truth. Duplicated unread counts, selected circle filters, chat preferences, and current user profile state have clear synchronization rules.

- [ ] **Step 4: Review network status and retries**

Expected: Network hooks, API timeouts, realtime recovery, and manual refresh paths do not create noisy retry loops or hide persistent failures.

## Task 8: Review UI, Accessibility, and Internationalization

**Files:**
- Review: `src/theme/**`
- Review: `src/components/ui/**`
- Review: `src/i18n/index.ts`
- Review: `src/i18n/locales/zh.json`
- Review: `src/i18n/locales/en.json`
- Review: representative screens from each `src/features/*/screens`

- [ ] **Step 1: Verify theme token usage**

Expected: Screens use theme tokens instead of hardcoded colors where practical, dark/light modes preserve contrast, and shared components do not bake in one feature's styling.

- [ ] **Step 2: Verify safe area and keyboard behavior**

Expected: Chat composer, tab screens, forms, and modal-like screens behave on small phones, Android, iOS, and web where supported.

- [ ] **Step 3: Verify i18n key coverage**

Expected: All user-visible strings either intentionally remain static or have `zh` and `en` translations. Missing keys and inconsistent terminology are listed.

- [ ] **Step 4: Verify accessibility basics**

Expected: Icon-only buttons have labels where supported, disabled/loading states are visible, destructive actions require clear intent, and text does not rely only on color.

## Task 9: Review Tests and Add Coverage Recommendations

**Files:**
- Review: `test/*.test.js`
- Review: `src/**/*.test.mts`
- Review: high-risk files identified in Task 1

- [ ] **Step 1: Classify existing tests**

Expected: Tests are grouped into API wrapper tests, route/screen static tests, store tests, utility tests, and integration-lifecycle tests.

- [ ] **Step 2: Identify brittle tests**

Expected: Regex/string-inspection tests that can pass while behavior breaks are marked for replacement with module-level or integration tests where feasible.

- [ ] **Step 3: Identify missing high-value tests**

Expected: Findings include targeted tests for auth refresh races, logout reset completeness, realtime reconnect/token switch, OpenIM listener idempotency, route param validation, and upload failure handling.

- [ ] **Step 4: Recommend CI gate**

Expected: Review proposes a minimal CI command set:

```bash
npx tsc --noEmit
node --test test/*.test.js
node --test src/features/discover/store/discover-state.test.mts
node --test src/features/discover/store/managed-circles.test.mts
node --test src/features/discover/utils/city-selection.test.mts
```

## Task 10: Finalize Findings and Follow-Up Plan

**Files:**
- Create: `docs/reviews/YYYY-MM-DD-project-code-review-findings.md`
- Optional create: `docs/superpowers/plans/YYYY-MM-DD-code-review-fixes.md`

- [ ] **Step 1: Write findings document**

Expected: Findings are ordered by severity, then by user impact. Each finding has exact file references and a concrete fix path.

- [ ] **Step 2: Separate fixes from refactors**

Expected: P0/P1 bugs have small fix plans. Larger maintainability work, such as splitting very large screens, is listed separately and does not block urgent fixes.

- [ ] **Step 3: Verify no accidental edits**

Run: `git diff --stat`

Expected: Only intended review documents were created or changed unless the reviewer was explicitly asked to implement fixes.

- [ ] **Step 4: Handoff summary**

Expected: Final response includes the findings document path, commands run, pass/fail status, and the recommended first fix batch.
