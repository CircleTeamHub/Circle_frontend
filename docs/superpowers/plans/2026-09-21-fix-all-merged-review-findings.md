# Fix All Outstanding Merged-Review Findings

> **For Codex:** Execute this plan with the `executing-plans` workflow. Use TDD for every behavior change, preserve released migration checksums, and do not push or open PRs without explicit authorization.

**Goal:** Resolve every still-open finding from the daily merged-code review in isolated local frontend/backend branches, including the existing backend self-destruct-boundary commit.

**Architecture:** Keep the changes narrowly scoped to the existing notification, auth-registration recovery, circle admission, retention, map integration, and deployment seams. Add compatibility at system boundaries (provider-aware push delivery, transaction-time policy rechecks, database trigger for mixed-version writers, and guarded migration preparation) rather than changing product behavior elsewhere.

**Tech Stack:** Expo/React Native/TypeScript/Node test runner (frontend); NestJS/Prisma/PostgreSQL/Jest/Bash release scripts (backend).

---

## Task 1: Frontend registration outcome safety

**Files:**
- Modify: `test/mutation-outcome.test.js`
- Modify: `test/auth-register-orphan-account.test.js`
- Modify: `src/services/api/mutation-outcome.ts`

1. Change the focused tests so a fetch-level `network` rejection is classified as an ambiguous mutation outcome and registration shows `auth.errors.registerOutcomeUnknown`.
2. Run the focused tests and confirm they fail for the old definite-failure behavior.
3. Make the minimal classifier change: any request that may have left the process without an authoritative HTTP response is ambiguous.
4. Re-run the focused tests and lint the changed files.
5. Commit as one frontend fix.

## Task 2: Frontend native AMap runtime contract

**Files:**
- Modify: `src/features/location/components/amap-native-surface.tsx`
- Modify: `src/features/location/utils/location-map.ts`
- Modify: `app.config.js`
- Modify: `.env.example`
- Modify: `test/location-basemap-provider.test.js`
- Create: `patches/expo-amap+0.2.4.patch`

1. Add focused tests for React `forwardRef` component exports, platform-specific native keys, ignored legacy single-key configuration, and the Android camera-region patch.
2. Run the tests and confirm failures against the current loader/configuration.
3. Accept renderable function or object component exports without weakening module validation.
4. Require separate `EXPO_PUBLIC_AMAP_IOS_KEY` and `EXPO_PUBLIC_AMAP_ANDROID_KEY`; choose availability by runtime platform and configure only present platform keys.
5. Patch expo-amap Android `onCameraChangeFinish` to emit `onRegionChanged` with map width/height.
6. Run focused tests, config generation, TypeScript, and changed-file lint.
7. Commit as one frontend fix.

## Task 3: Backend provider-aware push delivery with JPush

**Files:**
- Modify: `src/notification/notification.dto.ts`
- Modify: `src/notification/notification-push.service.ts`
- Modify: notification/outbox services and their specs as discovered
- Modify: `src/config/env.validation.ts` and `.env.example` as applicable
- Modify: `prisma/schema.prisma`
- Create: a new additive Prisma migration for delivery provider metadata

1. Add DTO and service tests proving `jpush` registration is accepted with its own token shape, Expo validation remains strict, and delivery routes by provider.
2. Add tests for JPush Basic authentication, per-provider payload mapping, 1000-registration batching, retryable server/network errors, and terminal invalid-token handling without disabling tokens on credential/server failures.
3. Run focused tests and confirm the old Expo-only implementation fails.
4. Persist provider/platform/project metadata on delivery records so retries remain deterministic even if device registrations change.
5. Implement standard JPush `/v3/push` delivery, preserve Expo delivery and receipt polling, and document paired JPush credentials.
6. Regenerate Prisma client if needed, then run focused tests, TypeScript, lint, migration checks, and diff checks.
7. Commit as one backend fix.

## Task 4: Backend circle invite/QR policy serialization

**Files:**
- Modify: `src/chat/chat-group-settings.service.ts` and spec
- Modify: `src/circle-invitation/circle-invitation.service.ts` and spec
- Modify: QR service/call sites and specs as discovered

1. Add tests proving policy writes take the circle policy lock before updating admission settings and QR redemption rechecks `qrJoinEnabled` inside the same locked invitation transaction.
2. Run the focused tests and confirm the existing split transaction fails.
3. Reuse the existing `CircleMemberLockService.lockPolicy` as the shared serialization boundary.
4. Pass an explicit QR-admission intent into the invitation transaction and perform the authoritative chat-policy recheck after acquiring the policy lock.
5. Run focused unit/concurrency tests, TypeScript, and lint.
6. Commit as one backend fix.

## Task 5: Backend viewer self-destruct notification privacy

**Files:**
- Modify: `src/chat/chat-push.service.ts`
- Modify: `src/chat/chat-push.service.spec.ts`

1. Add tests proving a recipient with `messageSelfDestructSec` receives a masked preview and a TTL no longer than that viewer policy, including the minimum of conversation and viewer windows.
2. Add a query-count assertion proving recipient privacy settings are loaded in one batch.
3. Run focused tests and confirm plaintext/current TTL behavior fails.
4. Batch-load recipient policies and build per-recipient protected payloads without N+1 queries.
5. Run focused tests, TypeScript, and lint.
6. Commit as one backend fix.

## Task 6: Backend mixed-version burn-policy compatibility

**Files:**
- Create: a new additive Prisma migration installing a narrow `ChatConversation` trigger
- Create/Modify: migration contract test under `src/chat/`

1. Add a migration contract test that requires a trigger to set `burnStartedAt` on disabled-to-enabled transitions made by old code, clear it on enabled-to-disabled transitions, preserve it while enabled, and respect an explicit timestamp from new code.
2. Run the test and confirm no compatibility migration exists.
3. Add an idempotent PostgreSQL trigger/function migration with only those transition semantics; do not rewrite the released migration.
4. Run the contract test and migration verification.
5. Commit as one backend fix.

## Task 7: Safe preparation for released hot ChatMessage migration

**Files:**
- Create: `scripts/prepare-chat-message-deleted-at-migration.mjs`
- Modify: production migration command/package script and release tests
- Create/Modify: focused script contract tests

1. Add tests for three states: fresh database/table absent (no-op), already-applied migration (no-op), and existing hot table with migration pending (add column, batch backfill with committed chunks, create the exact index concurrently, verify shape, then mark the released migration applied).
2. Add failure tests ensuring the script never marks the migration applied when schema preparation or exact verification fails.
3. Run the tests and confirm the current direct `prisma migrate deploy` path fails the contract.
4. Implement the guarded preparation script using the existing PostgreSQL dependency and a database advisory lock. Preserve the released migration file byte-for-byte.
5. Wire the production migration command to run preparation immediately before `prisma migrate deploy`.
6. Run focused release/migration tests, TypeScript where applicable, and diff/checksum checks.
7. Commit as one backend fix.

## Task 8: Integrated verification and local handoff

1. Confirm frontend and backend worktrees are clean except expected commits.
2. Run frontend focused tests, `npm run typecheck`, `npm run lint`, and `npm run expo:config` (record only genuine environment blockers).
3. Run backend focused suites, `npm run typecheck`/`tsc --noEmit`, lint, Prisma validation/generation, migration checks, and `git diff --check`.
4. Review each branch diff against its `origin/main`; confirm no secrets, generated noise, released migration edits, or unrelated files.
5. Update automation memory with commit SHAs, verification evidence, remaining blockers, and current run time.
6. Do not push, create PRs, merge, deploy, mutate data/configuration, or delete worktrees.
