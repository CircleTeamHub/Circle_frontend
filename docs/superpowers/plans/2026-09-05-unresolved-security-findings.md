# Unresolved Security Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every unresolved finding from the 2026-09-05 merged-code review without merging, deploying, or pushing.

**Architecture:** Keep each finding isolated on a dedicated `codex/` branch. Strengthen external object-storage startup contracts, bind production email bypasses to explicit identities and purposes, and enforce the direct-message auto-reply invariant at both the transactional API boundary and the UI boundary.

**Tech Stack:** NestJS, TypeScript, Prisma, AWS S3 SDK, Joi, Jest, Expo/React Native, React Testing Library.

## Global Constraints

- Start every implementation change with a focused failing test and observe the expected failure.
- Make the smallest production change that turns that test green.
- Keep storage, authentication, and auto-reply fixes in separate local branches and commits.
- Do not push, open or update pull requests, merge, deploy, rotate credentials, or change production data.
- Treat GitHub Linux CI as authoritative for Windows ACL-dependent shell tests.

---

### Task 1: Verify external object-storage CORS at startup

**Files:**
- Modify: `src/upload/upload.service.ts`
- Modify: `src/upload/upload.service.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `ALLOWED_ORIGINS`, external S3 credentials, and `GetBucketCorsCommand`.
- Produces: `UploadService.ensureExternalUploadCors()` and fail-closed production startup when no rule permits browser `PUT` requests with `content-type` and `if-none-match` from every configured origin.

- [ ] **Step 1: Write the failing startup test**

Add an external-production test whose mocked S3 calls return a valid bucket and lifecycle but no matching CORS rules, then assert:

```ts
await expect(service.onModuleInit()).rejects.toMatchObject({ status: 503 });
expect(send.mock.calls[2][0].constructor.name).toBe('GetBucketCorsCommand');
```

Add a passing-shape test with:

```ts
{
  CORSRules: [{
    AllowedOrigins: ['https://app.example.com'],
    AllowedMethods: ['PUT'],
    AllowedHeaders: ['content-type', 'if-none-match'],
  }],
}
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --runInBand src/upload/upload.service.spec.ts`

Expected: FAIL because bootstrap never sends `GetBucketCorsCommand` and accepts the invalid external bucket.

- [ ] **Step 3: Implement the minimal CORS verifier**

Import `GetBucketCorsCommand`, parse `ALLOWED_ORIGINS` into trimmed non-empty origins, and call this method after lifecycle verification:

```ts
private async ensureExternalUploadCors(): Promise<void> {
  const response = await this.client.send(
    new GetBucketCorsCommand({ Bucket: this.bucket }),
  );
  const requiredHeaders = ['content-type', 'if-none-match'];
  const missing = this.allowedOrigins.filter((origin) =>
    !(response.CORSRules ?? []).some((rule) => {
      const methods = (rule.AllowedMethods ?? []).map((value) => value.toUpperCase());
      const origins = rule.AllowedOrigins ?? [];
      const headers = (rule.AllowedHeaders ?? []).map((value) => value.toLowerCase());
      return methods.includes('PUT') &&
        (origins.includes(origin) || origins.includes('*')) &&
        requiredHeaders.every((header) => headers.includes(header) || headers.includes('*'));
    }),
  );
  if (missing.length > 0) {
    throw new Error('External object storage CORS does not allow browser uploads');
  }
}
```

Extend the bootstrap step union with `verify_upload_cors`, and document that the app credentials need read-CORS permission.

- [ ] **Step 4: Verify GREEN**

Run the focused upload service suite and confirm both valid and invalid CORS configurations behave as specified.

- [ ] **Step 5: Commit**

```text
fix(storage): verify external upload CORS at startup
```

### Task 2: Separate rate-limited media delivery from the COS signing endpoint

**Files:**
- Modify: `src/utils/storage-url.ts`
- Modify: `src/utils/storage-url.spec.ts`
- Modify: `src/upload/upload.service.ts`
- Modify: `src/upload/upload.service.spec.ts`
- Modify: `src/config/env.validation.ts`
- Modify: `src/config/env.validation.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: new exact `OBJECT_STORAGE_DELIVERY_URL` configuration.
- Produces: public media URLs under an explicitly configured CDN/rate-limited gateway while S3 PUT/GET signatures continue using `MINIO_PUBLIC_URL`.

- [ ] **Step 1: Write failing URL and startup tests**

Add tests asserting:

```ts
expect(storagePublicObjectBaseFromConfig(config)).toBe(
  'https://media.example.com/circle',
);
expect(result.uploadUrl).toContain('.cos.ap-tokyo.myqcloud.com/');
expect(result.fileUrl).toMatch(/^https:\/\/media\.example\.com\/circle\//);
```

Add a production external-storage startup test that omits `OBJECT_STORAGE_DELIVERY_URL` and expects HTTP 503 before upload service readiness.

- [ ] **Step 2: Run focused suites and verify RED**

Run: `npm test -- --runInBand src/utils/storage-url.spec.ts src/upload/upload.service.spec.ts src/config/env.validation.spec.ts`

Expected: FAIL because the exact delivery URL is ignored and external COS falls back to its direct public origin.

- [ ] **Step 3: Implement exact delivery-base selection**

Add the Joi URI field and prefer it in the shared helper:

```ts
const deliveryUrl = config.get<string>('OBJECT_STORAGE_DELIVERY_URL');
if (deliveryUrl) return stripTrailingSlashes(deliveryUrl);
```

In `UploadService`, preserve `MINIO_PUBLIC_URL` for `publicClient`, use `OBJECT_STORAGE_DELIVERY_URL` for `publicObjectBase`, and reject production external storage when the value is missing or has the same origin and path base as the direct COS object base. Keep the legacy fallback for bundled storage and non-production environments.

Document that the configured delivery URL must terminate at the Caddy `/circle/*` rate limiter or an equivalently rate-limited CDN/WAF.

- [ ] **Step 4: Verify GREEN**

Run the focused storage URL, upload, and environment suites; run ESLint and Prettier checks for the changed files.

- [ ] **Step 5: Commit**

```text
fix(storage): require rate-limited external media delivery
```

### Task 3: Bind production fixed codes to explicit identities and purposes

**Files:**
- Modify: `src/auth/email-verification.service.ts`
- Modify: `src/auth/__test__/email-verification.service.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `EMAIL_CODE_PRODUCTION_BYPASS_ALLOWLIST` entries formatted as `REGISTER:user@example.com` or `LOGIN:user@example.com`.
- Produces: a production bypass that requires both existing opt-ins and an exact normalized `(purpose, email)` allowlist match; `RESET_PASSWORD` is never bypassable.

- [ ] **Step 1: Replace the permissive production test with failing boundary tests**

Cover all of these cases:

```ts
await expect(
  service.verifyCode('allowed@example.com', 'REGISTER', '999999'),
).resolves.toBe(false); // no allowlist
await expect(
  service.verifyCode('allowed@example.com', 'REGISTER', '999999'),
).resolves.toBe(true); // exact entry
await expect(
  service.verifyCode('other@example.com', 'REGISTER', '999999'),
).resolves.toBe(false); // wrong identity
await expect(
  service.verifyCode('allowed@example.com', 'LOGIN', '999999'),
).resolves.toBe(false); // wrong purpose
await expect(
  service.verifyCode('allowed@example.com', 'RESET_PASSWORD', '999999'),
).resolves.toBe(false);
```

- [ ] **Step 2: Run the email-verification suite and verify RED**

Run: `npm test -- --runInBand src/auth/__test__/email-verification.service.spec.ts`

Expected: the no-allowlist, wrong-identity, wrong-purpose, and reset cases incorrectly return true.

- [ ] **Step 3: Implement exact allowlist matching**

Change the bypass resolver to accept normalized email and purpose. In production, require `EMAIL_CODE_ALLOW_PRODUCTION_BYPASS=true`, reject `RESET_PASSWORD`, parse the comma-separated allowlist, and return the fixed code only when `${purpose}:${email}` matches exactly. Keep the existing explicit development bypass behavior.

Document the new variable with fake examples and state that password reset cannot be enabled.

- [ ] **Step 4: Verify GREEN**

Run the focused auth suite, targeted ESLint, and Prettier checks.

- [ ] **Step 5: Commit**

```text
fix(auth): scope production email code bypass
```

### Task 4: Enforce non-empty text for enabled direct-message auto replies

**Files:**
- Backend modify: `src/privacy/privacy-settings.service.ts`
- Backend modify: `src/privacy/privacy-settings.service.spec.ts`
- Frontend modify: `src/features/profile/screens/DirectMessageAutoReplyScreen.tsx`
- Frontend modify: `src/features/profile/screens/DirectMessageAutoReplyScreen.spec.tsx`
- Frontend modify: `src/i18n/locales/en.json`
- Frontend modify: `src/i18n/locales/zh.json`
- Frontend modify: `src/i18n/locales/es.json`
- Frontend modify: `src/i18n/locales/ja.json`
- Frontend modify: `src/i18n/locales/ko.json`

**Interfaces:**
- Consumes: the existing partial privacy-settings PATCH and account-scoped frontend draft.
- Produces: disabled auto replies may retain a draft, but the effective persisted state cannot be enabled with blank text; the frontend explains and blocks that invalid save.

- [ ] **Step 1: Write failing backend tests**

Add tests that reject both `enabled=true + blank text` and enabling a stored blank draft through a partial PATCH, while allowing `enabled=false + blank text`.

- [ ] **Step 2: Verify backend RED**

Run: `npm test -- --runInBand src/privacy/privacy-settings.service.spec.ts`

Expected: invalid enabled states are persisted instead of rejected.

- [ ] **Step 3: Implement transactional final-state validation**

Inside the existing per-user lock transaction, read current settings, merge the compact patch, and validate:

```ts
if (
  effective.directMessageAutoReplyEnabled &&
  !effective.directMessageAutoReplyText.trim()
) {
  throw new BadRequestException(
    'Direct-message auto reply text is required when enabled',
  );
}
```

Keep disabled empty drafts valid.

- [ ] **Step 4: Verify backend GREEN and commit**

Run the focused privacy suite, targeted ESLint/Prettier, then commit:

```text
fix(privacy): reject empty enabled auto replies
```

- [ ] **Step 5: Write the failing frontend behavior test**

Load disabled blank settings, enable the switch, and assert that the Save action is disabled, the required-copy is visible, and `updatePrivacySettings` is not called.

- [ ] **Step 6: Verify frontend RED**

Run: `npm run test:behavior -- --runInBand src/features/profile/screens/DirectMessageAutoReplyScreen.spec.tsx`

Expected: Save remains enabled and the required-copy does not exist.

- [ ] **Step 7: Implement the UI guard**

Compute:

```ts
const replyTextRequired = preference.enabled && !preference.message.trim();
const canSave = dirty && !replyTextRequired && !loading && !saving;
```

Use `canSave` for button state and color, render `settingsDetails.autoReply.messageRequired`, and add that key to all five locale files.

- [ ] **Step 8: Verify frontend GREEN and commit**

Run the focused screen test, locale parity/completeness tests, scoped ESLint, typecheck when dependencies permit, and the broader Jest behavior suite. Commit:

```text
fix(settings): block empty enabled auto replies
```

### Task 5: Final verification and handoff

**Files:**
- Review only: every diff and branch status.

**Interfaces:**
- Consumes: the four local commits.
- Produces: clean isolated worktrees, test evidence, and branch/commit references for manual review.

- [ ] **Step 1: Run branch-level verification**

Run focused suites again from clean committed heads, `git diff --check`, targeted lint/format checks, and broader repository tests proportionate to each change.

- [ ] **Step 2: Audit scope**

Confirm every changed line traces to one finding, no credentials or real identities were added, and no remote refs were mutated.

- [ ] **Step 3: Report**

Report local branch names, commit SHAs, tests passed, and any pre-existing environmental failures. Do not push or create PRs.
