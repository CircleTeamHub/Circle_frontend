# Final Review Fix Report

Date: 2026-07-09
Branch: `fix/local-data-backup-exclusion`

## Result

Resolved the final review findings. Expo SecureStore no longer competes with the
project-owned Android backup rules, the dangerous mod is exercised through Expo's
registered mod function, iOS initialization is covered as fail-closed, and local
history no longer contains `b03331d`.

## Root Cause and RED Evidence

The earlier `expo config --type introspect --json` probe exited 0 with empty stderr,
but JSON mode suppresses config warnings. The representative non-JSON path exposed
the real conflict.

Command:

```text
node --test --test-name-pattern="Expo introspection has no SecureStore" test/native-branding-config.test.js
```

Result: exit 1. The new assertion captured:

```text
Expo-secure-store tried to apply Android Auto Backup rules, but other backup rules are already present.
```

Root cause: Expo manifest mods execute in nested order. The project plugin supplied
its owned references before SecureStore's manifest mod inspected them, so
SecureStore warned even though the final references remained correct.

## Fix

- Configured `expo-secure-store` with `configureAndroidBackup: false` in `app.json`.
- Kept the project plugin as the sole owner of both Android backup XML resources.
- Added a non-JSON Expo introspection assertion for the warning path.
- Changed the XML artifact test to execute `config.mods.android.dangerous` against a
  temporary project root and verify both generated XML files structurally.
- Added an iOS failure-path test proving a rejected `RNFS.mkdir` rejects
  `ensureOpenIMInitialized`, records initialization failure, and never calls
  `OpenIMSDK.initSDK`.

## Regression-Test Validation

The dangerous-mod and iOS behavior already existed, so their new coverage was
validated with temporary mutations and then restored.

Dangerous-mod mutation:

```text
node --test --test-name-pattern="dangerous mod writes owned" test/native-branding-config.test.js
```

Result: exit 1 after temporarily removing `withDangerousMod` registration;
`dangerousMod` was `undefined`. After restoration, 1 passed and 0 failed.

iOS fail-closed mutation:

```text
node --test --test-name-pattern="aborts when iOS backup exclusion" test/im-client.test.js
```

Result: exit 1 after temporarily swallowing the `mkdir` rejection; the test reported
`Missing expected rejection`. After restoration, 1 passed and 0 failed.

## Focused GREEN Evidence

```text
node --test test/native-branding-config.test.js
```

Result: 5 passed, 0 failed.

```text
node --test --test-name-pattern="ensureOpenIMInitialized" test/im-client.test.js
```

Result: 2 passed, 0 failed.

```text
npm run typecheck
```

Result: exit 0.

## Full Verification

```text
npm run ci
```

Result: exit 0.

- TypeScript: passed.
- Expo public config: passed; only the existing Sentry organization/project warning
  was emitted.
- ESLint: passed with zero warnings allowed.
- Node tests: 952 total, 951 passed, 1 skipped, 0 failed.
- Jest behavior tests: 2 suites passed, 6 tests passed, 0 failed.

## History Rewrite

`git rebase --onto e2edc67 b03331d` replayed the valid local commits without the
unrelated route-cast commit. The rewritten route commit contains only the useful
source regression test.

Pre-final-fix history:

```text
965d728 fix(routes): restore notification typed routes
f1b4011 fix(android): own backup exclusion rules
972aa3e docs: design backup exclusion hardening
e2edc67 fix(android): enforce backup exclusion in prebuild manifest
b03ddc6 fix: exclude local chat data from backups
```

`git merge-base --is-ancestor b03331d HEAD` returned exit 1, proving `b03331d` is
not an ancestor of the rewritten branch.

## Review Adjudication

No review finding was rejected. The initially suggested blind plugin reorder was
not used: a representative non-JSON introspection reproduced the underlying warning,
and the explicit SecureStore ownership switch fixed it without relying on implicit
mod-order behavior. Final introspection preserves `@xml/windnote_backup_rules` and
`@xml/windnote_data_extraction_rules` with no SecureStore conflict warning.
