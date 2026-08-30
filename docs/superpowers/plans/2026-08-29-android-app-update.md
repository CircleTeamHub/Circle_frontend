# Android App Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Android builds detect a newer signed APK, prompt the user, download it, and open the system package installer without uninstalling the current app.

**Architecture:** The Android release workflow will publish an HTTPS `release.json` beside `windnote.apk` in the dedicated `CircleTeamHub/windnote-releases` GitHub Release. A focused app-update module will validate that manifest, compare integer Android version codes, and download only the exact official versioned APK URL before handing a content URI to Android's installer; a root host performs a best-effort startup check and the existing version screen supports a manual check.

**Tech Stack:** Expo SDK 55, React Native 0.83, TypeScript, expo-file-system legacy API, expo-intent-launcher, node:test, GitHub Actions, Cloudflare R2.

## Global Constraints

- Android-only APK installation; iOS and web must remain unaffected.
- Existing login/bootstrap and navigation behavior must remain unchanged.
- The update manifest and APK must use HTTPS and the exact official GitHub release repository paths.
- Update availability is determined by `versionCode`, not lexical semantic-version comparison.
- Startup network failures are silent; manual-check and download failures are localized and actionable.
- The existing signed release pipeline remains the sole producer of the GitHub release assets and promoted R2 APK.

---

### Task 1: Manifest contract and version decision

**Files:**
- Create: `src/features/app-update/app-update-manifest.ts`
- Test: `src/features/app-update/app-update-manifest.test.mts`

**Interfaces:**
- Produces: `AndroidReleaseManifest`, `parseGitHubReleaseManifest(value)`, and `isAndroidUpdateAvailable(currentVersionCode, manifest)`.

- [x] **Step 1: Write failing tests for a valid manifest, malformed fields, unofficial/non-HTTPS APK URLs, and version-code comparison.**
- [x] **Step 2: Run `node --test src/features/app-update/app-update-manifest.test.mts` and confirm failure because the module is absent.**
- [x] **Step 3: Implement strict parsing with schema version `1`, a positive integer `versionCode`/`sizeBytes`, 64-character SHA-256, and exact official GitHub APK URL validation.**
- [x] **Step 4: Re-run the focused test and confirm it passes.**

### Task 2: Android check, download, and install flow

**Files:**
- Create: `src/features/app-update/app-update-service.ts`
- Create: `src/features/app-update/AppUpdateHost.tsx`
- Modify: `app/_layout.tsx`
- Modify: `app.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/app-update-feature.test.js`

**Interfaces:**
- Consumes: manifest parser and version decision from Task 1.
- Produces: `checkForAndroidUpdate()` and `downloadAndInstallAndroidUpdate(manifest)`, plus a root host that prompts once per application process.

- [x] **Step 1: Write a failing source/config contract test requiring Android-only gating, a bounded no-store manifest fetch, file-size verification, content-URI installer launch, `REQUEST_INSTALL_PACKAGES`, root-host wiring, and the Expo Intent Launcher dependency.**
- [x] **Step 2: Run `node --test test/app-update-feature.test.js` and confirm expected failures.**
- [x] **Step 3: Install the Expo SDK 55-compatible `expo-intent-launcher` dependency and add the Android install-packages permission.**
- [x] **Step 4: Implement the bounded update check, cache download, exact byte-size verification, cleanup on failure, and `android.intent.action.VIEW` installer launch with read permission.**
- [x] **Step 5: Implement and mount the startup host; prompt only when a strictly newer version code is returned and keep startup failures silent.**
- [x] **Step 6: Re-run the focused test and TypeScript typecheck.**

### Task 3: Manual update check and localized feedback

**Files:**
- Modify: `src/features/profile/screens/about-article-screen.tsx`
- Modify: `src/features/profile/screens/AboutVersionScreen.tsx`
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ja.json`
- Modify: `src/i18n/locales/ko.json`
- Modify: `src/i18n/locales/es.json`
- Test: `test/app-update-feature.test.js`

**Interfaces:**
- Consumes: `checkForAndroidUpdate()` and `downloadAndInstallAndroidUpdate()`.
- Produces: a manual Check for Updates button with loading, latest, available, and failure feedback.

- [x] **Step 1: Extend the failing contract test to require the manual action and complete locale-key parity.**
- [x] **Step 2: Add a minimal optional footer slot to `AboutArticleScreen` and implement the version-screen action with duplicate-press and unmount protection.**
- [x] **Step 3: Add matching update strings to all five locale files.**
- [x] **Step 4: Run the focused tests and existing profile settings test.**

### Task 4: Publish the latest release manifest

**Files:**
- Modify: `.github/workflows/android-release.yml`
- Modify: `.github/scripts/publish-android-release.js`
- Modify: `test/android-release-workflow.test.js`

**Interfaces:**
- Produces: `https://github.com/CircleTeamHub/windnote-releases/releases/latest/download/release.json` containing `{ schemaVersion, version, versionCode, apkUrl, sha256, sizeBytes }`.

- [x] **Step 1: Add failing workflow assertions for manifest generation, metadata fields, immutable GitHub asset publishing, and ordering before latest promotion.**
- [x] **Step 2: Run `node --test test/android-release-workflow.test.js` and confirm the new assertions fail.**
- [x] **Step 3: Generate the manifest from the checked-out tagged `app.json` and verified APK, then publish it with the APK in the dedicated GitHub Release.**
- [x] **Step 4: Re-run the workflow tests.**

### Task 5: Full verification

**Files:**
- Verify only.

- [x] **Step 1: Run `npm run typecheck`.**
- [x] **Step 2: Run `npm run lint`.**
- [x] **Step 3: Run `npm test` (the update tests pass; four unrelated baseline failures remain documented in the handoff).**
- [x] **Step 4: Run `npm run test:behavior`.**
- [x] **Step 5: Inspect `git diff --check`, `git diff --stat`, and the final diff for unrelated changes or missing cleanup.**
