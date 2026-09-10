# Review Findings Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every still-applicable production-readiness finding from the 2026-09-09 merged-code review while treating old-client compatibility as out of scope during testing.

**Architecture:** Preserve the existing email-code service and reinstate it only as registration ownership proof, while retaining password confirmation. Classify transport/5xx registration outcomes as ambiguous on the client. Serialize message edits with group silence changes through the existing conversation-row lock, and make unknown unhandled rejections report then terminate so the orchestrator can restart a clean process.

**Tech Stack:** Expo/React Native, TypeScript, NestJS, Prisma, Jest, Node test runner.

## Global Constraints

- No compatibility layer for older mobile clients is required.
- Use existing email verification, rate limiting, error codes, and localized UI patterns.
- Keep changes surgical; do not redesign authentication or chat architecture.
- Write and observe each regression test failing before production changes.
- Do not push, open a PR, merge, or deploy without a later explicit request.

---

### Task 1: Carry forward the validated privacy-cache fix

**Files:**

- Modify: `src/chat-core/socket-manager.ts`
- Test: `test/chat-core-socket-manager.test.js`

**Interfaces:**

- Consumes: legacy `viewer-self-destruct-days:<userId>` persisted values.
- Produces: validated `viewer-self-destruct-sec:<userId>` values.

- [x] **Step 1:** Cherry-pick local commit `c7080d5` onto the frontend remediation branch.
- [x] **Step 2:** Run `node --test test/chat-core-socket-manager.test.js`; expect all socket-manager tests to pass.

### Task 2: Require email ownership proof and handle ambiguous registration outcomes

**Files:**

- Modify: `src/features/auth/screens/RegisterScreen.tsx`
- Modify: `src/features/auth/validation.ts`
- Modify: `src/hooks/use-auth.ts`
- Modify: `src/hooks/use-send-email-code.ts`
- Modify: `src/services/api/auth.ts`
- Create: `src/services/api/mutation-outcome.ts`
- Modify: `src/i18n/locales/{en,es,ja,ko,zh}.json`
- Test: `test/auth-api.test.js`
- Test: `test/auth-invite-code-screen.test.js`
- Test: `test/auth-register-orphan-account.test.js`
- Test: `test/auth-validation.test.js`
- Modify backend: `src/auth/auth.controller.ts`
- Modify backend: `src/auth/auth.service.ts`
- Modify backend: `src/auth/auth.module.ts`
- Modify backend: `src/auth/dto/register.dto.ts`
- Create backend: `src/auth/dto/request-email-code.dto.ts`
- Modify backend: `src/metrics/route-normalizer.ts`
- Modify backend: `src/setup.ts`
- Test backend: `src/auth/__test__/auth.controller.spec.ts`
- Test backend: `src/auth/__test__/auth.service.spec.ts`
- Test backend: `src/auth/dto/register.dto.spec.ts`

**Interfaces:**

- Consumes: `POST /auth/email/request-code` with `{email, purpose:'register'}` and `POST /auth/register` with email, six-digit code, password, confirmation, nickname, and optional invite code.
- Produces: tokens only after `EmailVerificationService.verifyCode(email, 'REGISTER', code)` succeeds; transport/5xx failures display `auth.errors.registerOutcomeUnknown`.

- [x] **Step 1:** Add frontend tests requiring the email-code request, six-digit validation, registration code payload, and ambiguous-result guidance; run them and observe expected failures.
- [x] **Step 2:** Add backend tests requiring the rate-limited request-code route, six-digit DTO field, and verification before user creation; run them and observe expected failures.
- [x] **Step 3:** Restore the existing registration-code UI/API path while retaining confirm-password and invite-code behavior. Add a generic `isAmbiguousMutationFailure` classifier for non-HTTP, status 0, and 5xx outcomes.
- [x] **Step 4:** Restore the backend route, limiter/metrics registration, DTO code field, and verification call without removing password confirmation.
- [x] **Step 5:** Run the focused frontend and backend authentication suites; expect all tests to pass.

### Task 3: Fail fast on unknown unhandled promise rejections

**Files:**

- Modify backend: `src/logging/unhandled-rejection-guard.ts`
- Test backend: `src/logging/unhandled-rejection-guard.spec.ts`

**Interfaces:**

- Consumes: process-level `unhandledRejection` events that escaped local error handling.
- Produces: one operational-error report followed by `process.exit(1)`.

- [x] **Step 1:** Change tests to require exit code 1 after reporting, including when reporting itself throws; run and observe failures because the current guard continues.
- [x] **Step 2:** Put termination in a `finally` block after reporting so reporting failure cannot suppress restart.
- [x] **Step 3:** Run the focused rejection-guard suite; expect all tests to pass.

### Task 4: Make silence authoritative for message edits

**Files:**

- Modify backend: `src/chat/chat.service.ts`
- Test backend: `src/chat/chat.service.spec.ts`

**Interfaces:**

- Consumes: the current `ChatMember.silencedAt/silencedUntil` state after locking `ChatConversation`.
- Produces: `CHAT_MEMBER_SILENCED` without updating or broadcasting edited content.

- [x] **Step 1:** Add tests for an already-silenced editor and for silence applied between preflight and the locked recheck; run and observe both failures.
- [x] **Step 2:** Keep the cheap preflight check, then lock the conversation row inside the edit transaction and re-read membership before the conditional update.
- [x] **Step 3:** Run the complete chat-service suite; expect all tests to pass.

### Task 5: Verify and commit both repositories

**Files:**

- Review all files changed by Tasks 1-4.

- [x] **Step 1:** Run frontend focused behavior tests, scoped ESLint, formatting/diff checks, and `npm run typecheck`.
- [x] **Step 2:** Run backend focused suites, scoped ESLint, formatting/diff checks, and `npm run build`.
- [x] **Step 3:** Inspect `git diff --check`, `git diff --stat`, and status in both worktrees.
- [x] **Step 4:** Commit frontend and backend changes separately with focused commit messages.
