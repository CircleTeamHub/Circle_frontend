# Security and Retention Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every outstanding 2026-09-14 merged-code finding except the explicitly excluded native-map integration.

**Architecture:** Keep Redis as an early revocation deny path, but make PostgreSQL authoritative whenever Redis does not prove revocation. Persist a conversation-level burn start timestamp and apply one shared visibility model—viewer retention plus a two-segment burn window—to REST reads, search, unread counts, reply snapshots, mutation sync, and destructive cleanup. Keep the already-tested frontend list-window fixes and teach the client to consume the authoritative burn start timestamp.

**Tech Stack:** NestJS, TypeScript, Prisma/PostgreSQL, Redis, Jest, Expo/React Native, Zustand, Node test runner.

## Global Constraints

- Do not change native AMap integration.
- Do not push, open a PR, merge, deploy, or mutate production data/configuration.
- Use regression tests before every production-code change.
- Preserve legacy burn behavior only when an already-enabled row has no `burnStartedAt`; the migration must backfill active rows so normal rollout preserves existing history.
- Keep frontend and backend work on isolated local `codex/` branches.

---

### Task 1: Make durable session state authoritative

**Files:**
- Modify: `src/auth/session-verifier.service.ts`
- Modify: `src/auth/__test__/session-verifier.service.spec.ts`

**Interfaces:**
- Consumes: `SessionRevocationService.checkRevocation(token): Promise<'revoked' | 'active' | 'unknown'>`
- Produces: `SessionVerifier.verify(token): Promise<'active' | 'revoked' | 'unavailable'>` where only Redis `revoked` short-circuits PostgreSQL.

- [ ] **Step 1: Write the failing regression test**

Add a case where `checkRevocation` returns `active`, the database user is banned or the session row is logged out, and `verify` must return `revoked`. Keep a separate assertion that Redis `revoked` performs no database query.

- [ ] **Step 2: Run the test to verify RED**

Run: `npx jest --runInBand auth/__test__/session-verifier.service.spec.ts`
Expected: the Redis-active/database-revoked case returns `active` instead of `revoked`.

- [ ] **Step 3: Implement the minimal authority change**

Use this control flow:

```ts
const state = await this.revocation.checkRevocation(token);
if (state === 'revoked') return 'revoked';
return this.verifyInDatabase(token);
```

Update comments so `active` means only “Redis found no revocation marker,” not an authoritative allow.

- [ ] **Step 4: Run auth verification**

Run: `npx jest --runInBand auth/__test__/session-verifier.service.spec.ts auth/session-revocation.service.spec.ts`
Expected: both suites pass.

- [ ] **Step 5: Commit the backend auth fix**

Commit message: `fix(auth): keep durable revocation authoritative`

### Task 2: Model and test the durable burn boundary

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260914010000_add_chat_burn_started_at/migration.sql`
- Create: `src/chat/chat-retention.ts`
- Create: `src/chat/chat-retention.spec.ts`
- Modify: `src/chat/chat.types.ts`

**Interfaces:**
- Produces: `ChatConversation.burnStartedAt: DateTime?`
- Produces: `ChatRetentionWindow { viewerCutoff, burnStartedAt, burnCutoff }`
- Produces: helpers that build Prisma visibility filters and decide whether one timestamp is visible.

- [ ] **Step 1: Write failing retention-helper tests**

Cover four cases: burn disabled; legacy enabled row with no start; pre-start message remains visible after the duration; post-start expired message becomes hidden. The expected burn predicate is equivalent to:

```ts
burnCutoff === null ||
(burnStartedAt !== null && createdAt < burnStartedAt) ||
createdAt >= burnCutoff
```

- [ ] **Step 2: Run the helper test to verify RED**

Run: `npx jest --runInBand chat/chat-retention.spec.ts`
Expected: compilation fails because `chat-retention.ts` does not exist.

- [ ] **Step 3: Add the schema, migration, DTO field, and minimal helper**

Add `burnStartedAt DateTime?` beside `burnDurationSec`. The migration must add the nullable column and set it to `CURRENT_TIMESTAMP` only for conversations whose burn duration is already enabled. Add optional ISO `burnStartedAt` to the conversation DTO and burn-policy response types.

- [ ] **Step 4: Generate Prisma and run the helper test**

Run: `npx prisma generate` and `npx jest --runInBand chat/chat-retention.spec.ts`
Expected: the retention helper suite passes.

- [ ] **Step 5: Commit the backend model/helper change**

Commit message: `feat(chat): persist burn activation boundary`

### Task 3: Apply the burn boundary to every backend path

**Files:**
- Modify: `src/chat/chat-burn-sweeper.service.ts`
- Modify: `src/chat/chat-burn-sweeper.service.spec.ts`
- Modify: `src/chat/chat.service.ts`
- Modify: `src/chat/chat.service.spec.ts`
- Modify: `src/chat/chat.controller.ts`

**Interfaces:**
- Consumes: the retention helpers from Task 2.
- Produces: GET/POST burn responses and conversation DTOs containing `burnStartedAt`.
- Produces: identical retention semantics for history, last-message previews, unread counts, search, message days, reply snapshots, mutations, forwarding/visibility checks, relax cleanup, and cron cleanup.

- [ ] **Step 1: Write failing service and sweeper tests**

Add assertions that enabling from off writes a start timestamp, changing an active duration preserves it, disabling clears it, GET/POST return it, and sweeper/relax queries contain `createdAt.gte = burnStartedAt`. Add visibility assertions showing a pre-start message remains readable while an expired post-start message is hidden.

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `npx jest --runInBand chat/chat-retention.spec.ts chat/chat-burn-sweeper.service.spec.ts chat/chat.service.spec.ts`
Expected: new start-boundary assertions fail against the current duration-only implementation.

- [ ] **Step 3: Implement write and destructive-cleanup semantics**

When enabling from off, write one `now` value to `burnStartedAt`; when changing an active duration, preserve the existing start; when disabling, set it to null. Add the start lower bound to sweeper and relax-cleanup queries, while retaining legacy duration-only behavior for an enabled row whose start is null.

- [ ] **Step 4: Implement read semantics**

Replace duration-only cutoffs with `ChatRetentionWindow`. Prisma paths must combine viewer retention with the burn OR predicate. Raw list/unread/mutation queries must unnest viewer cutoff, burn start, and burn cutoff separately and apply the same predicate. Reply snapshots must use the same per-conversation window.

- [ ] **Step 5: Run focused backend tests**

Run: `npx jest --runInBand chat/chat-retention.spec.ts chat/chat-burn-sweeper.service.spec.ts chat/chat.service.spec.ts chat/chat.controller.spec.ts`
Expected: all focused chat tests pass.

- [ ] **Step 6: Commit the backend chat fix**

Commit message: `fix(chat): preserve messages from before burn activation`

### Task 4: Make the hot-table migration deployment-safe

**Files:**
- Modify: `prisma/migrations/20260913001000_add_chat_message_deleted_at/migration.sql`
- Create: `prisma/migrations/20260913001100_index_chat_message_deleted_at/migration.sql`
- Create: `src/chat/chat-message-deleted-at-migration.spec.ts`

**Interfaces:**
- Produces: a metadata-only column migration and a separate `CREATE INDEX CONCURRENTLY IF NOT EXISTS` migration.

- [ ] **Step 1: Write the failing SQL contract test**

Assert that the column migration has no bulk `UPDATE` and no `CREATE INDEX`, and that the index migration contains exactly the concurrent idempotent index creation for `ChatMessage(conversationID, deletedAt)`.

- [ ] **Step 2: Run the migration test to verify RED**

Run: `npx jest --runInBand chat/chat-message-deleted-at-migration.spec.ts`
Expected: the existing migration still contains the bulk update and ordinary index.

- [ ] **Step 3: Split the migration**

Keep only `ALTER TABLE ... ADD COLUMN` in the original migration. Do not invent deletion timestamps for historical tombstones. Put `CREATE INDEX CONCURRENTLY IF NOT EXISTS` in the new migration.

- [ ] **Step 4: Run migration verification**

Run: `npx jest --runInBand chat/chat-message-deleted-at-migration.spec.ts chat/chat-member-fanout-index-migration.spec.ts`
Expected: both migration-contract suites pass.

- [ ] **Step 5: Commit the backend migration fix**

Commit message: `fix(db): avoid blocking chat message migration`

### Task 5: Consume the authoritative burn start in the frontend

**Files:**
- Modify: `src/chat-core/protocol.ts`
- Modify: `src/chat-core/api.ts`
- Modify: `src/features/chat/screens/ChatDetailScreen.tsx`
- Modify: `src/chat-core/store.ts`
- Modify: `test/chat-core-conversation-snapshot-freshness.test.js`
- Modify: `test/chat-core-store.test.js`

**Interfaces:**
- Consumes: optional `burnStartedAt` on conversation snapshots and burn-policy responses.
- Produces: `applyBurnDuration(conversationId, duration, burnStartedAt)` using the server timestamp when present and preserving the rolling-release fallback when absent.

- [ ] **Step 1: Write failing frontend contract tests**

Assert that a POST burn response with `burnStartedAt` passes that exact timestamp to the store, a GET policy does the same, and conversation snapshot merge accepts the typed field without a cast. Retain tests proving old servers without the field preserve the local fallback.

- [ ] **Step 2: Run frontend tests to verify RED**

Run: `node --test test/chat-core-conversation-snapshot-freshness.test.js test/chat-core-store.test.js`
Expected: the API does not forward the server timestamp.

- [ ] **Step 3: Implement the protocol and API changes**

Add optional `burnStartedAt: string | null` to both DTOs, pass it through POST and GET handling, and remove comments/casts claiming the server cannot provide it. Keep absence-compatible local normalization for rolling deployment.

- [ ] **Step 4: Run frontend verification**

Run: `node --test test/chat-core-conversation-snapshot-freshness.test.js test/chat-core-store.test.js test/chat-core-dispatcher.test.js`
Expected: all tests pass, including the existing list-window regression.

- [ ] **Step 5: Commit the frontend burn contract change**

Commit message: `fix(chat): sync burn activation boundary`

### Task 6: Final verification and handoff

**Files:**
- Verify all files changed by Tasks 1–5.

**Interfaces:**
- Produces: clean local frontend and backend branches with no remote mutation.

- [ ] **Step 1: Run backend checks**

Run focused Jest suites, `npx tsc --noEmit`, changed-file ESLint, and `git diff --check`.

- [ ] **Step 2: Run frontend checks**

Run the relevant Node chat/API suites, changed-file ESLint, available typecheck, and `git diff --check`.

- [ ] **Step 3: Inspect both final diffs and statuses**

Confirm only auth, retention, migration, frontend burn-contract, list-window, tests, and this plan are present. Confirm neither branch was pushed.

- [ ] **Step 4: Complete the local branches**

Use `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`; report commit SHAs, verification evidence, and any environment-only blocker without claiming it passed.
