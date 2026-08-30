# Android Preproduction CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a signed Android 1.0.1 preproduction APK that connects only to the Tokyo test stack, and establish a fail-closed path from a green commit on `main` to a private build artifact and, once all release gates are satisfied, a public GitHub/R2 release.

**Architecture:** Keep the existing tag-driven `android-release.yml` as the only public publishing path. Add a separate manually dispatched preproduction workflow that runs the complete verification suite, builds with the production signing identity, embeds the test endpoints, verifies the APK and publishes only a private GitHub Actions artifact. Public promotion remains gated by Sentry source-map upload, dependency notices/SBOM, explicit distribution approval, and a protected GitHub environment.

**Tech Stack:** Expo SDK 53, React Native, TypeScript, Gradle, GitHub Actions, Node.js contract tests, Sentry, GitHub Releases, Cloudflare R2.

## Global Constraints

- Do not restore or overwrite the deleted `windnote.apk` asset on release `v1.0.0`.
- Never place Android keystores, passwords, Tencent credentials, Sentry tokens, or R2 credentials in tracked files or workflow logs.
- A preproduction artifact is private and has a 30-day retention period; it is not uploaded to GitHub Releases or R2.
- Do not enable public publishing until the protected `android-production` environment, Sentry values, dependency evidence, and explicit distribution approval all exist.
- The expected API is `https://api-43-133-201-42.sslip.io`.
- The expected media origin is `https://windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com`.
- The obsolete Cloudflare tunnel and OpenIM endpoint variables must not appear in a newly built APK.

---

### Task 1: Preserve the old-release removal as an audited precondition

**Files:**
- No repository files

- [x] Delete only asset ID `478760956` (`windnote.apk`) from release ID `354862640`.

  Command already executed:

  ```powershell
  gh api -X DELETE repos/CircleTeamHub/windnote-releases/releases/assets/478760956
  ```

- [x] Verify that release `v1.0.0` and its tag remain, while its asset list is empty.

  Verified result:

  ```json
  {"assets":[],"draft":false,"id":354862640,"tag_name":"v1.0.0"}
  ```

### Task 1A: Restore a cross-platform clean baseline in the isolated worktree

**Files:**
- Modify: `test/error-message-wrapping.test.js`
- Modify: `test/themed-switch.test.js`
- Modify: `test/repo-hygiene.test.js`

- [x] Run `npm run ci` before implementation and record the three expected failures: two Windows path-separator allowlist mismatches and Git's worktree ownership guard.

- [x] Normalize paths returned by `path.relative` to `/` before comparing them with repository-relative allowlists.

- [x] Invoke the repository-hygiene test's read-only Git command with `-c safe.directory=<current worktree>` so it does not require persistent global Git configuration.

- [x] Run the three focused tests, then the complete `npm run ci` baseline.

- [ ] Commit the baseline portability fix.

### Task 2: Fix the Chrome smoke-test cleanup race blocking CI

**Files:**
- Modify: `.github/scripts/smoke-web-export.js`
- Test: `test/desktop-web-review-fixes.test.js`

- [ ] Add a failing source-contract assertion to the existing browser-smoke test.

  The assertion must require bounded retry options on the recursive removal:

  ```js
  assert.match(smokeScript, /maxRetries:\s*5/);
  assert.match(smokeScript, /retryDelay:\s*200/);
  ```

- [ ] Run the focused test and confirm that it fails before implementation.

  ```powershell
  node --test test/desktop-web-review-fixes.test.js
  ```

- [ ] Make cleanup tolerate the Windows/Linux Chromium profile-release race without hiding persistent failures.

  Replace the final profile cleanup with:

  ```js
  fs.rmSync(userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
  ```

- [ ] Run both the focused contract test and the browser smoke command.

  ```powershell
  node --test test/desktop-web-review-fixes.test.js
  node .github/scripts/smoke-web-export.js
  ```

- [ ] Commit the isolated fix.

  ```powershell
  git add .github/scripts/smoke-web-export.js test/desktop-web-review-fixes.test.js
  git commit -m "fix(ci): retry Chrome profile cleanup"
  ```

### Task 3: Prepare Android 1.0.1 and make the preproduction endpoint contract explicit

**Files:**
- Modify: `app.json`
- Modify: `.github/scripts/validate-android-release.js`
- Modify: `test/android-release-workflow.test.js`
- Modify: `docs/android-release.md`

- [ ] Add failing release-validator tests for the exact version and deployment inputs.

  Tests must cover:

  ```text
  tag v1.0.1 -> app version 1.0.1 -> Android versionCode 1000001
  EXPO_PUBLIC_API_URL must be HTTPS
  EXPO_PUBLIC_MEDIA_ORIGINS must contain only HTTPS origins
  public distribution rejects an absent media-origin value
  ```

- [ ] Run the focused test and confirm the new expectations fail.

  ```powershell
  node --test test/android-release-workflow.test.js
  ```

- [ ] Update application metadata.

  In `app.json`, set:

  ```json
  {
    "expo": {
      "version": "1.0.1",
      "android": {
        "versionCode": 1000001
      }
    }
  }
  ```

- [ ] Extend `validate-android-release.js` so release validation parses `EXPO_PUBLIC_MEDIA_ORIGINS` as a comma-separated list, rejects credentials, query strings, fragments, non-HTTPS schemes, and missing hostnames, and requires at least one origin when distribution mode is `public`.

- [ ] Document the preproduction values and the distinction between private artifacts and public distribution in `docs/android-release.md`.

- [ ] Run the focused tests.

  ```powershell
  node --test test/android-release-workflow.test.js
  ```

- [ ] Commit the release metadata and validation contract.

  ```powershell
  git add app.json .github/scripts/validate-android-release.js test/android-release-workflow.test.js docs/android-release.md
  git commit -m "chore(android): prepare v1.0.1 preprod release"
  ```

### Task 4: Generate dependency notices and an SBOM that travel with the APK

**Files:**
- Create: `scripts/generate-third-party-notices.mjs`
- Create: `test/third-party-notices.test.js`
- Create: `assets/legal/THIRD_PARTY_NOTICES.txt`
- Create: `assets/legal/cyclonedx-sbom.json`
- Modify: `package.json`
- Modify: `src/features/profile/screens/AboutVersionScreen.tsx`
- Modify: the locale resources used by `AboutVersionScreen.tsx`

- [ ] Add failing tests that require deterministic, non-empty notices and SBOM files, reject `UNKNOWN` licenses, and prove `@openim/rn-client-sdk` is absent from production dependencies.

  The test must execute:

  ```powershell
  npm ls --omit=dev --all --json
  ```

  and assert that every reachable production package has a package name, version, declared license, and a matching notice entry.

- [ ] Run the focused test and confirm it fails while the generated artifacts are absent.

  ```powershell
  node --test test/third-party-notices.test.js
  ```

- [ ] Implement `generate-third-party-notices.mjs`.

  The script must:

  1. Read the production dependency tree using `npm ls --omit=dev --all --json`.
  2. Deduplicate by `name@version` and sort lexically.
  3. Resolve each installed package directory from the root dependency graph.
  4. Read SPDX license metadata and the package's `LICENSE*`, `LICENCE*`, `COPYING*`, or `NOTICE*` files.
  5. Fail on missing or ambiguous license metadata rather than silently labeling it unknown.
  6. Write deterministic UTF-8 notices and CycloneDX 1.5 JSON without timestamps or host paths.
  7. Fail if the production tree contains `@openim/rn-client-sdk`.

- [ ] Add scripts to `package.json`.

  ```json
  {
    "scripts": {
      "licenses:generate": "node scripts/generate-third-party-notices.mjs",
      "licenses:check": "node scripts/generate-third-party-notices.mjs --check"
    }
  }
  ```

- [ ] Add a “Third-party licenses” action to the existing About/version screen and render the bundled notice text in a scrollable, selectable view. Do not fetch legal text from the network.

- [ ] Generate the artifacts, run the focused test, and confirm a second generation produces no diff.

  ```powershell
  npm run licenses:generate
  node --test test/third-party-notices.test.js
  git diff --exit-code -- assets/legal/THIRD_PARTY_NOTICES.txt assets/legal/cyclonedx-sbom.json
  ```

- [ ] Commit the dependency evidence.

  ```powershell
  git add scripts/generate-third-party-notices.mjs test/third-party-notices.test.js assets/legal package.json src/features/profile/screens/AboutVersionScreen.tsx
  git add src/locales
  git commit -m "feat(legal): bundle Android dependency notices"
  ```

### Task 5: Add a private, signed preproduction APK workflow

**Files:**
- Create: `.github/workflows/android-preprod-build.yml`
- Create: `.github/scripts/verify-android-preprod.js`
- Create: `test/android-preprod-build-workflow.test.js`
- Modify: `docs/android-release.md`

- [ ] Write failing workflow-contract tests requiring all of these properties:

  ```text
  workflow_dispatch only
  concurrency cancels an older preproduction build
  npm ci and npm run ci run before Gradle
  Android signing secrets are required
  SENTRY_DISABLE_AUTO_UPLOAD=true is limited to this private workflow
  EXPO_PUBLIC_API_URL and EXPO_PUBLIC_MEDIA_ORIGINS come from repository variables
  assembleRelease produces a signed release APK
  apksigner verifies the configured certificate fingerprint
  the APK is scanned for expected and forbidden endpoints
  the APK, SHA-256 file, notices, and SBOM are one private Actions artifact
  retention-days is 30
  no GitHub Release, R2, RELEASES_TOKEN, or public-publish step exists
  ```

- [ ] Run the focused test and confirm failure before creating the workflow.

  ```powershell
  node --test test/android-preprod-build-workflow.test.js
  ```

- [ ] Implement `verify-android-preprod.js` with two commands:

  ```text
  metadata: verify version 1.0.1, versionCode 1000001, HTTPS test endpoints
  apk: verify the APK contains api-43-133-201-42.sslip.io and the Tokyo COS origin,
       and does not contain application-diary-papua-dining.trycloudflare.com or OpenIM URLs
  ```

  It must exit non-zero on an absent expected string, a forbidden string, a malformed APK, or an unexpected version.

- [ ] Implement `android-preprod-build.yml` as a manually dispatched, private artifact workflow:

  ```yaml
  on:
    workflow_dispatch:

  permissions:
    contents: read

  concurrency:
    group: android-preprod
    cancel-in-progress: true
  ```

  Required build order:

  1. Checkout the selected `main` commit.
  2. Install pinned Node and Java versions used by the existing Android workflow.
  3. Run `npm ci`, `npm run licenses:check`, and `npm run ci`.
  4. Decode the signing keystore into the runner temporary directory.
  5. Export repository-variable endpoints and `SENTRY_DISABLE_AUTO_UPLOAD=true`.
  6. Run the same Expo prebuild/Gradle release commands and ABI selection as the existing release workflow.
  7. Verify package ID, versionCode, signature certificate, expected endpoints, and forbidden endpoints.
  8. Create `windnote-preprod-v1.0.1.apk` and its lowercase SHA-256 file.
  9. Upload the APK, checksum, notices, and SBOM as one Actions artifact retained for 30 days.
  10. Remove decoded signing material in an `if: always()` step.

- [ ] Run workflow lint/contract tests.

  ```powershell
  node --test test/android-preprod-build-workflow.test.js
  npm run test:workflow-lint
  ```

- [ ] Commit the private build workflow.

  ```powershell
  git add .github/workflows/android-preprod-build.yml .github/scripts/verify-android-preprod.js test/android-preprod-build-workflow.test.js docs/android-release.md
  git commit -m "ci(android): add private preprod APK build"
  ```

### Task 6: Correct GitHub deployment variables without exposing credentials

**Files:**
- No repository files

- [ ] Set the current test endpoints on `CircleTeamHub/Circle_frontend`.

  ```powershell
  gh variable set EXPO_PUBLIC_API_URL --repo CircleTeamHub/Circle_frontend --body "https://api-43-133-201-42.sslip.io"
  gh variable set EXPO_PUBLIC_CHAT_WS_URL --repo CircleTeamHub/Circle_frontend --body "https://api-43-133-201-42.sslip.io"
  gh variable set EXPO_PUBLIC_MEDIA_ORIGINS --repo CircleTeamHub/Circle_frontend --body "https://windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com"
  ```

- [ ] Remove the two obsolete OpenIM variables after confirming the application code does not reference them.

  ```powershell
  rg -n "EXPO_PUBLIC_OPENIM_(API|WS)_URL" .
  gh variable delete EXPO_PUBLIC_OPENIM_API_URL --repo CircleTeamHub/Circle_frontend
  gh variable delete EXPO_PUBLIC_OPENIM_WS_URL --repo CircleTeamHub/Circle_frontend
  ```

- [ ] Verify the variable names and non-secret values.

  ```powershell
  gh variable list --repo CircleTeamHub/Circle_frontend
  ```

### Task 7: Run production-readiness verification and update the ready PR

**Files:**
- Modify only files listed in Tasks 2–5

- [ ] Confirm no unrelated user files, patches, archives, or worktrees are staged.

  ```powershell
  git status --short
  git diff --cached --name-only
  ```

- [ ] Run the complete local verification suite.

  ```powershell
  npm run typecheck
  npm run lint
  npm test
  npm run test:behavior
  npm run ci
  ```

- [ ] Review the complete branch diff for secrets, endpoint leakage, release-gate regressions, and accidental public-upload paths.

  ```powershell
  git diff origin/main...HEAD
  git diff --check origin/main...HEAD
  ```

- [ ] Push `codex/android-app-update` and update PR #178 without converting it to a draft.

  ```powershell
  git push origin codex/android-app-update
  gh pr view 178 --repo CircleTeamHub/Circle_frontend --json isDraft,mergeable,statusCheckRollup,url
  ```

- [ ] Wait for all required PR checks to pass. Do not merge while any required check is failing or pending.

### Task 8: Produce and verify the replacement private APK

**Files:**
- No additional repository files

- [ ] Merge PR #178 only after review and green required checks, then dispatch the private workflow against the resulting `main` commit.

  ```powershell
  gh workflow run android-preprod-build.yml --repo CircleTeamHub/Circle_frontend --ref main
  gh run list --repo CircleTeamHub/Circle_frontend --workflow android-preprod-build.yml --limit 1
  ```

- [ ] Wait for completion and download the artifact into a newly created temporary directory.

  ```powershell
  $preprodRunId = gh run list --repo CircleTeamHub/Circle_frontend --workflow android-preprod-build.yml --limit 1 --json databaseId --jq '.[0].databaseId'
  New-Item -ItemType Directory -Path .tmp\android-preprod-v1.0.1
  gh run download $preprodRunId --repo CircleTeamHub/Circle_frontend --dir .tmp\android-preprod-v1.0.1
  ```

  Abort if `$preprodRunId` is empty or if that run's `headBranch` is not `main`.

- [ ] Verify SHA-256, APK signature, versionCode, package ID, and embedded endpoint allow/deny lists locally using the same scripts and certificate fingerprint as CI.

- [ ] Install on a test Android device and smoke-test login, media upload/download, chat connection, and the in-app update check. Record only redacted results; do not capture tokens, chat content, email addresses, or device identifiers.

- [ ] Keep the resulting APK private. Its download location is the successful GitHub Actions run, not `windnote-releases`.

### Task 9: Enable public CD only after every hard gate is satisfied

**Files:**
- Modify: `docs/android-release.md` only if the repository plan/environment status changes
- GitHub settings: protected environment `android-production`

- [ ] Upgrade or configure the repository so `android-production` supports required reviewers, then move public-release secrets and approval variables into that protected environment.

- [ ] Configure `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and secret `SENTRY_AUTH_TOKEN`; prove a release build uploads source maps successfully.

- [ ] Publish the dependency notice/SBOM evidence at a stable HTTPS URL reviewed by the repository owner.

- [ ] Set the public gates only after the preceding checks pass:

  ```powershell
  gh variable set ANDROID_DISTRIBUTION_APPROVED --repo CircleTeamHub/Circle_frontend --body "true"
  gh variable set ANDROID_DISTRIBUTION_EVIDENCE_URL --repo CircleTeamHub/Circle_frontend --body "https://github.com/CircleTeamHub/Circle_frontend/blob/main/assets/legal/THIRD_PARTY_NOTICES.txt"
  gh variable set ANDROID_PUBLIC_RELEASE_ENABLED --repo CircleTeamHub/Circle_frontend --body "true"
  ```

- [ ] Create and push `v1.0.1` only from the exact verified commit on `main`.

  ```powershell
  git switch main
  git pull --ff-only origin main
  git tag -s v1.0.1 -m "WindNote Android v1.0.1"
  git push origin v1.0.1
  ```

- [ ] Verify the tag workflow publishes immutable `windnote.apk`, `windnote.apk.sha256`, and `release.json` assets to GitHub Releases and the matching versioned/latest objects to R2.

- [ ] Immediately set `ANDROID_PUBLIC_RELEASE_ENABLED=false` again if any post-publish signature, checksum, manifest, update-check, or endpoint verification fails; then remove only the failed version's release assets after resolving their exact IDs.
