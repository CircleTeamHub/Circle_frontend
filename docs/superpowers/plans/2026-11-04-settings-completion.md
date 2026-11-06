# Settings completion implementation plan

> Use subagent-driven-development for scoped implementation and review. Execute continuously; preserve existing unrelated workspace edits.

**Goal:** Fix the audited settings defects, starting with privacy responsiveness, and complete ringtone selection, account deletion and verified email changes.

**Architecture:** Retain existing settings screens, Zustand stores and NestJS endpoints. Use one in-flight save per settings form; reuse account/session and notification infrastructure. No new dependencies or generalized settings framework.

**Tech stack:** Expo Router, React Native, TypeScript, Zustand, existing Jest/Node tests; NestJS/Prisma for missing account and offline-push contracts.

## Constraints

- Preserve the working tree's pre-existing changes; do not commit or deploy.
- Do not run real account deletion, send verification emails, or mutate a live user's settings during tests.
- Sensitive forms fence writes with sessionEpoch; use existing localized/redacted error handling.
- Backend additions need source changes plus migration and focused tests, not frontend-only fake switches.

## Task 1: Privacy interactions (priority)

Files: `src/features/profile/screens/PrivacySettingsScreen.tsx`, its `.spec.tsx`, `src/features/profile/components/settings-detail.tsx` and focused component tests.

- [x] Test delayed save keeps rows visually stable; duplicate saves submit once.
- [x] Test unrelated privacy saves do not call `setViewerSelfDestructSec`; changed burn policy does.
- [x] Test initial GET failure leaves controls unavailable and exposes retry.
- [x] Test missing optional online/typing fields are unavailable; save responses omitting a requested field show an error.
- [x] Implement minimal fixes; allow label-area taps on controlled toggles without double submission.
- [x] Run focused behavior/API tests and review diff.

## Task 2: Existing correctness defects

Files: profile editor component/spec, account-security screen/spec, system-permissions screen/spec, cache service/test.

- [x] Reproduce old profile response after account switch; fence `setUser` by epoch.
- [x] Reproduce single-device GET/PATCH failure; show errors and retry without presenting unknown state as saved false.
- [x] Test foreground permission refresh and listener cleanup.
- [x] Test SQLite database/WAL accounting with current cache mocks; include real chat storage in usage.
- [x] Verify each fix with focused tests; preserve existing UI conventions.

## Task 3: Notifications and ringtone selectors

Files: notification settings screen, feedback store/hook, snackbar host, realtime/client, chat dispatcher, API notifications, backend group push preference/controller/service/schema/migration.

- [x] Test disabled friend/group application banners and disabled group online banners.
- [x] Add GET/PUT `/notification/group-push-preference` with `{ groupOfflinePushEnabled: boolean }`; enforce it during group chat push fanout.
- [x] Test offline preference initial load, failed write rollback and global switch's effective offline value.
- [x] Add persistent `messageRingtone`/`circleRingtone` selections (`default`, `soft`, `bell`) and bundled short audio assets; test playback source selection.
- [x] Distinguish in-app audio from OS notification sound in copy and provide system-settings entry.

## Task 4: Account actions

Files: account-security screen, new cancel-account/change-email screens and route exports, auth API, profile configuration, backend auth/email-verification DTO/service/schema/migration/tests.

- [x] Use existing self-only `DELETE /user/:id` for explicit account deletion confirmation; clear local session only for the captured session after success.
- [x] Add password + new-mailbox-code email change endpoints and purpose-specific code verification; reject duplicate email and invalidate old sessions through existing auth lifecycle.
- [x] Test password/code failures, success and stale-session UI responses; enable email row via dedicated secure route.
- [x] Add translated labels and synchronize settings search entries.

## Task 5: Integration verification

- [x] Run `npm run typecheck`, lint and relevant behavior/Node suites; broaden once to project required checks.
- [x] Run backend build and focused auth/notification tests with mocked external services.
- [x] Review complete task diff, fix concrete findings, and record rollout requirements.
- [x] Remove task-owned temporary caches/processes and verify process completion.

## Rollout and verification notes

- Backend changes live in the sibling `circle_be_main` checkout on `codex/settings-completion-20261104`; no deployment or database migration was run.
- Apply `prisma/migrations/20261105000000_complete_settings/migration.sql` through the existing migration command, then publish the backend before the frontend. It adds `CHANGE_EMAIL` and `User.groupOfflinePushEnabled`.
- Privacy, notification, account-action, permission and storage regression checks include delayed completion after navigation and account switches.
- Frontend full CI reached 3,585 Node tests: 3,542 passed, 30 skipped, 13 failed in Windows Bash/release harnesses. Re-running the five affected files outside the sandbox passed 25 of 34; nine release/Bash cases still failed. Those workflow/script files are unchanged by this task.
- Backend focused auth, email, notification and chat-push suites: 274 tests passed. Backend build passed.
- Final full behavior run passed: 174 suites, 1,481 tests. TypeScript and frontend lint passed. Backend targeted lint has zero errors and five existing Sonar warnings.

- Current-password failures are excluded from both auth-refresh and forced-session-clear branches by exact `AUTH_PASSWORD_INCORRECT`; ordinary expired-token recovery remains enabled. Focused API/auth/logging/localization tests passed (77 pass, one unrelated skip).
- System-settings links handle browsers without calling unavailable native APIs; native open failures show a localized fallback.
- Temporary test processes exited; task-owned caches/staging were removed after verification. Verification logs remain under `.codex-preview/settings-*.log`.
