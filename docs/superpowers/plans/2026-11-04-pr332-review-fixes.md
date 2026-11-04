# PR 332 review fixes implementation plan

> **For agentic workers:** Execute the auth fix in this workspace and request an independent review before pushing the existing PR branch.

**Goal:** Preserve the Android alias/security-question changes, fix confirmed login fallback failures, verify CI, and document the supported email-code configuration.

**Architecture:** Keep server-side authentication authoritative. Expose a retry for the idempotent security-question lookup in the existing hook and render it on the verification screen. Reuse existing backend fixed-code configuration; the user confirmed development/preproduction only.

**Tech Stack:** Expo Router, React Native, TypeScript, Jest and Node tests.

## Constraints

- Preserve unrelated worktrees and the parallel PR 333 changes.
- Do not merge or deploy; push reviewed fixes to PR 332's existing branch.
- Do not add client-only authentication bypasses or silently enable a production master code.
- Do not retry non-idempotent login/registration/submission operations automatically.

## Checklist

- [x] Review all 32 changed files and verify API contracts against backend PR 303.
- [x] Verify current PR CI baseline: all checks pass at 2079abd9.
- [x] Add a regression where the security-question GET fails transiently and retrying the same challenge succeeds.
- [x] Expose lookup failure/retry in the hook, preserve cancellation on challenge change/unmount, and render a translated retry action on the screen.
- [x] Add screen behavior coverage and translations for all five locales.
- [x] Resolve the requested 999999 scope using the existing backend configuration; keep the frontend request contract server-authorized.
- [x] Run typecheck, lint, Node tests, behavior tests and the applicable local web-export checks.
- [x] Obtain independent review before committing. Remote CI status is recorded on the existing PR after pushing.

## Review finding

- P2: A transient question lookup failure is treated like an account with no configured questions. Polling can recover while this new login fallback stays hidden for the same challenge. The focused fix provides an explicit GET retry without restarting or resending the challenge.
- P2: After selecting security questions, a replacement challenge whose question lookup fails hides the mode switch. Keep the return-to-trusted-device action available while question mode is selected.

## Verification

- Regression cases failed before their fixes and passed afterward; targeted hook/screen suite: 11 tests.
- Full behavior suite: 170 suites, 1420 tests passed. Typecheck and lint passed.
- Production web export, source-map removal and Chrome smoke for `/` and `/qr` passed.
- Preserved the author's concurrent `bae00491` refresh lookup timeout fix before the final Node test run.
- Final Node suite: 3532 passed, 0 failed, 0 skipped. Independent follow-up review found no remaining actionable P1/P2 issues.
- Backend companion: circle_be#303, commit `9c04e8e`; 32 auth/config/metrics suites, 598 tests passed. Independent review found no further actionable issues.
- See `docs/email-verification-code.md` for explicit dev/preproduction configuration. No merge, deployment or server configuration change is part of this task.
