# Android Release Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #57 the single fail-closed Android release pipeline: only reviewed `main` tags can build a private signed artifact, and public promotion requires a protected environment and explicit distribution evidence.

**Architecture:** Split validation and workflow execution at trust boundaries. A secret-free preflight validates the tag and application metadata, a build job creates and certificate-checks a private artifact, and a default-disabled protected publish job promotes that exact artifact. Keep the existing Expo signing plugin and immutable publisher; supersede PR #56 instead of merging its competing workflow.

**Tech Stack:** GitHub Actions, Node.js 22 built-in test runner, Expo SDK 55 config plugins/prebuild, Gradle/Android `apksigner`, GitHub CLI release API.

---

### Task 1: Split release validation by trust boundary

**Files:**
- Modify: `.github/scripts/validate-android-release.js`
- Modify: `test/android-release-workflow.test.js`

- [ ] **Step 1: Write failing validator tests**

Add focused tests that import and exercise:

```js
validateReleaseMetadata({ env, app })
validateSigningConfig({ env })
validateDistributionApproval({ env })
```

The metadata validator must require a strict `vMAJOR.MINOR.PATCH` tag, a matching app version and derived `versionCode`, and credential-free HTTPS/WSS production URLs without inspecting signing or publishing secrets. The signing validator must require the four Android keystore values plus a valid SHA-256 certificate fingerprint. The distribution validator must require all three explicit gates:

```js
ANDROID_PUBLIC_RELEASE_ENABLED === 'true'
ANDROID_DISTRIBUTION_APPROVED === 'true'
ANDROID_DISTRIBUTION_EVIDENCE_URL is credential-free HTTPS
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern='release validation' test/android-release-workflow.test.js
```

Expected: FAIL because the three scoped validator exports do not exist.

- [ ] **Step 3: Implement the minimal scoped validators**

Refactor shared required-value and URL helpers without changing the existing semantic version formula. Add a CLI scope selected by `process.argv[2]`:

```text
metadata | signing | distribution | all
```

Keep a missing scope equivalent to `all` so the existing workflow remains functional between the Task 1 and Task 2 commits. Reject an unknown scope and emit every validation error as `::error::...`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same command and expect all matching tests to pass.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/validate-android-release.js test/android-release-workflow.test.js
git commit -m "test: separate Android release validation gates"
```

### Task 2: Restructure the workflow into preflight, private build, and protected promotion

**Files:**
- Modify: `.github/workflows/android-release.yml`
- Modify: `test/android-release-workflow.test.js`

- [ ] **Step 1: Write failing workflow-contract tests**

Extend the existing workflow test to require:

- exactly one `push.tags: ["v*"]` release trigger plus a required `workflow_dispatch.inputs.release_tag` input;
- tag resolution from `inputs.release_tag` for manual runs and `github.ref_name` for tag pushes;
- one `android-release-publish` concurrency group with `cancel-in-progress: false`;
- top-level `contents: read` permissions, no broader build permission, and the fixed `CircleTeamHub/windnote-releases` destination;
- `preflight`, `build`, `publish`, and `notify` jobs;
- preflight checkout with `fetch-depth: 0` and `persist-credentials: false`;
- `git merge-base --is-ancestor HEAD origin/main` before any `secrets.` reference;
- no release-secret reference inside the complete preflight job;
- checkout by the exact preflight commit SHA in later jobs;
- `metadata`, `signing`, and `distribution` validator invocations in their respective jobs;
- Android signing secrets confined to the build job and `RELEASES_TOKEN` absent there;
- `SENTRY_DISABLE_AUTO_UPLOAD: "true"` on the Gradle build;
- certificate verification before artifact upload;
- pinned `actions/upload-artifact` and `actions/download-artifact` actions;
- `environment: android-release-publish`;
- `vars.ANDROID_PUBLIC_RELEASE_ENABLED == 'true'` on the publish job;
- `RELEASES_TOKEN` appearing only in the final publisher step;
- Discord notification with `needs: [preflight, build, publish]` and `if: always()`.

- [ ] **Step 2: Run the workflow test and verify RED**

Run:

```bash
node --test --test-name-pattern='Android release workflow' test/android-release-workflow.test.js
```

Expected: FAIL because the current workflow is a single secret-bearing build-and-publish job.

- [ ] **Step 3: Implement the preflight job**

Define required manual input `release_tag`. Resolve the tag from `inputs.release_tag` on `workflow_dispatch` and `github.ref_name` on tag pushes, output both tag and commit SHA, check out with full history/no persisted credentials, validate metadata, require the commit to be on `origin/main`, then run `npm ci` and `npm run ci`. Do not map or reference any release secret in this job.

- [ ] **Step 4: Implement the private build job**

Check out the exact preflight SHA with no persisted credentials. Validate signing inputs in a secret-scoped step, install dependencies, run `expo prebuild --clean`, restore the keystore under `$RUNNER_TEMP`, build with Sentry upload disabled, verify the certificate, create `windnote.apk` plus `windnote.apk.sha256`, and upload both as a private artifact with pinned `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`.

- [ ] **Step 5: Implement the protected publish job**

Make the job depend on preflight/build and guard it with the repository variable `ANDROID_PUBLIC_RELEASE_ENABLED`. Target `android-release-publish`, check out the exact SHA without credentials, download the artifact with pinned `actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`, verify its SHA-256 file, validate distribution evidence, and expose `RELEASES_TOKEN` only in the step invoking `.github/scripts/publish-android-release.js`.

- [ ] **Step 6: Implement final Discord notification**

Report the observable result of each needed job and link to the Actions run or public release. Do not invent a distinct environment-rejection result.

- [ ] **Step 7: Run workflow tests and verify GREEN**

Run:

```bash
node --test test/android-release-workflow.test.js
```

Expected: all Android release tests pass.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/android-release.yml test/android-release-workflow.test.js
git commit -m "ci: gate Android release promotion"
```

### Task 3: Document the fail-closed rollout

**Files:**
- Create: `docs/android-release.md`
- Modify: `test/android-release-workflow.test.js`

- [ ] **Step 1: Write a failing documentation-contract test**

Require the document to state:

- #57 is the only workflow and #56 must not be merged;
- repository variables/secrets for metadata and signing;
- protected `android-release-publish` environment required reviewers;
- environment-only `RELEASES_TOKEN`, approval flag, and HTTPS evidence URL;
- `ANDROID_PUBLIC_RELEASE_ENABLED` must remain false until protection is verified;
- commands to inventory repository secrets and inspect required-reviewer protection plus the environment deployment branch/tag policy;
- the repository's SBOM/LICENSE/NOTICE/patch/legal evidence gate;
- tag and artifact verification steps.

- [ ] **Step 2: Run the documentation test and verify RED**

Run:

```bash
node --test --test-name-pattern='release rollout documentation' test/android-release-workflow.test.js
```

Expected: FAIL because `docs/android-release.md` does not exist.

- [ ] **Step 3: Write the rollout document**

Document the exact required names, fail-closed setup order, `gh api` verification commands, tag command, expected pipeline stages, and rollback rule. Do not include secret values or claim legal approval exists.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same command and expect it to pass.

- [ ] **Step 5: Commit**

```bash
git add docs/android-release.md test/android-release-workflow.test.js
git commit -m "docs: document protected Android releases"
```

### Task 4: Verify, review, and update the two PRs

**Files:**
- Verify all files changed since `origin/codex/android-release-automation`
- Update GitHub PR #57 description
- Close GitHub PR #56 as superseded

- [ ] **Step 1: Run focused tests**

```bash
node --test test/android-release-workflow.test.js
```

Expected: all Android release tests pass.

- [ ] **Step 2: Run the complete repository gate**

```bash
npm run ci
```

Expected: typecheck, Expo config, lint, Node tests, and Jest all pass.

- [ ] **Step 3: Verify generated Android configuration**

```bash
npx expo prebuild --platform android --clean --no-install
cd android && ./gradlew :app:tasks --no-daemon
```

Expected: prebuild and Gradle configuration succeed, and the production signing block exists once.

- [ ] **Step 4: Lint the workflow and inspect the diff**

Run the repository's actionlint version against `.github/workflows/android-release.yml`, then:

```bash
git diff --check origin/codex/android-release-automation...HEAD
git diff --stat origin/codex/android-release-automation...HEAD
git status --short --branch
```

Expected: no workflow lint errors, no whitespace errors, and only intended files changed.

- [ ] **Step 5: Push the reviewed commits to PR #57**

```bash
git push origin HEAD:codex/android-release-automation
```

Then replace PR #57's placeholder body with the summary, risk controls, setup checklist, and verification evidence.

- [ ] **Step 6: Wait for PR #57 checks**

Use `gh pr checks 57 --repo CircleTeamHub/Circle_frontend --watch` and require all mandatory checks to finish successfully.

- [ ] **Step 7: Supersede PR #56**

Close PR #56 with a concise comment linking PR #57 and explaining that the two workflows cannot coexist. Do this only after PR #57 is pushed and its checks are green.
