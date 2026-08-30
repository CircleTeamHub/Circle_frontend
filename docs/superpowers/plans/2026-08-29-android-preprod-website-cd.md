# Android Preproduction Website CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically publish every verified Android preproduction build from `main` to a stable Cloudflare R2 URL used by the WindNote website.

**Architecture:** Keep the signed build and the public upload in separate GitHub Actions jobs so R2 credentials never enter the build job. Upload a commit-addressed immutable APK first, verify its size and SHA-256 metadata, then copy that verified object to the stable preproduction URL. Point the website at the separate preproduction channel so the gated formal-release channel remains untouched.

**Tech Stack:** GitHub Actions, Expo/Gradle, AWS CLI against Cloudflare R2, Astro, Node test runner, Vitest, Playwright.

## Global Constraints

- Only a workflow running from `refs/heads/main` may publish the preproduction `latest` object.
- Preserve `.github/workflows/android-release.yml` and its default-disabled formal distribution gate.
- Do not use or overwrite `android/latest/windnote.apk`; preproduction uses `android/preprod/`.
- Never expose R2 credentials to pull requests, logs, the signed-build step, or website code.
- Publish only after the existing APK signature, package, version, endpoint, checksum, notices, and SBOM checks pass.

---

### Task 1: Lock the preproduction publication contract with tests

**Files:**
- Modify: `test/android-preprod-build-workflow.test.js`

**Interfaces:**
- Consumes: `.github/workflows/android-preprod-build.yml` as text.
- Produces: assertions for automatic `main` builds, a secret-isolated `publish` job, immutable SHA keys, stable preproduction promotion, and post-upload verification.

- [ ] **Step 1: Change the trigger test to require `push.branches: [main]` while preserving manual dispatch and cancellation.**
- [ ] **Step 2: Add a test requiring `publish` to depend on `build`, run only for `refs/heads/main`, download the exact artifact, validate its checksum, and be the only job receiving R2 credentials.**
- [ ] **Step 3: Require the upload to use `android/preprod/builds/${GITHUB_SHA}/windnote.apk`, promote by `copy-object` to `android/preprod/latest/windnote.apk`, and verify size, digest metadata, content type, and the public URL.**
- [ ] **Step 4: Run `node --test test/android-preprod-build-workflow.test.js`; expect failure because the workflow is still manual/private-only and has no `publish` job.**

### Task 2: Implement verified R2 publication

**Files:**
- Modify: `.github/workflows/android-preprod-build.yml`
- Modify: `docs/android-release.md`

**Interfaces:**
- Consumes: `android-preprod-v1.0.1` Actions artifact and existing repository R2 secrets/variable.
- Produces: `https://pub-9d36120697ca455b9fb0e430da8b9481.r2.dev/android/preprod/latest/windnote.apk`.

- [ ] **Step 1: Add the `main` push trigger, keeping `workflow_dispatch` for explicit rebuilds.**
- [ ] **Step 2: Add a `publish` job with `needs: build` and a main-ref condition; download the exact artifact and run `sha256sum -c`.**
- [ ] **Step 3: Upload the verified APK to the commit-addressed R2 key with immutable caching and SHA-256 metadata.**
- [ ] **Step 4: Verify the immutable object using `head-object`, then copy it to the stable preproduction key with five-minute caching.**
- [ ] **Step 5: Verify the promoted object metadata and make a cache-busted public HEAD request that requires the APK media type and expected byte length.**
- [ ] **Step 6: Document the channel separation, automatic trigger, stable URL, and rollback rule.**
- [ ] **Step 7: Run the focused workflow test and expect it to pass.**

### Task 3: Point the website at the preproduction channel

**Files (in `CircleTeamHub/Circle_Web`):**
- Modify: `src/config/downloads.test.ts`
- Modify: `tests/e2e/site.spec.ts`
- Modify: `src/config/downloads.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the stable preproduction R2 URL from Task 2.
- Produces: all Chinese/English website Android buttons linking to that URL.

- [ ] **Step 1: Change unit and e2e expectations to `android/preprod/latest/windnote.apk`.**
- [ ] **Step 2: Run the focused tests and expect them to fail against the old `android/latest` default.**
- [ ] **Step 3: Change the single default URL and document that the website currently distributes the Tokyo preproduction build.**
- [ ] **Step 4: Run `npm run ci`; expect Astro check, Vitest, and Playwright to pass.**

### Task 4: Verify and integrate both repositories

**Files:**
- No additional product files.

**Interfaces:**
- Consumes: green local branches from Tasks 2 and 3.
- Produces: ready-for-review PRs and a verified live APK endpoint.

- [ ] **Step 1: Run `npm run ci` and `npm run licenses:check` in `Circle_frontend`; run `npm run ci` in `Circle_Web`.**
- [ ] **Step 2: Run actionlint on the modified workflow and inspect both diffs for secret leakage or accidental formal-release changes.**
- [ ] **Step 3: Commit and push both `codex/` branches, create ready-for-review PRs, and wait for required checks.**
- [ ] **Step 4: Merge the app PR first; wait for its automatic preproduction workflow and verify the public preproduction URL reports the expected size/type.**
- [ ] **Step 5: Merge the website PR; wait for Cloudflare Pages deployment and verify the live download button resolves to the new stable preproduction URL.**

