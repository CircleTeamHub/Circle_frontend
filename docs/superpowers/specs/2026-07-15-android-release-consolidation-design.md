# Android Release Consolidation Design

## Goal

Consolidate PRs #56 and #57 into one Android release implementation on PR #57. A version tag must build reviewed `main` code, produce a signed and certificate-verified private artifact, and publish it to `CircleTeamHub/windnote-releases` only after the repository's binary-distribution evidence gate is approved.

## Scope

PR #57 remains the canonical implementation. It keeps the Expo config plugin, semantic-version-derived Android `versionCode`, release certificate verification, immutable asset publishing, pinned third-party actions, and public release repository. PR #56 is superseded after the consolidated implementation is pushed and verified.

The change does not add Play Store delivery, iOS delivery, EAS Build, or automatic legal approval. It does not change application runtime behavior.

## Release Pipeline

The existing `.github/workflows/android-release.yml` becomes a single pipeline with four jobs:

1. `preflight` runs without release secrets. It resolves a strict stable semantic-version tag, checks out the tag with full history and without persisted credentials, verifies that the tag commit is an ancestor of `origin/main`, validates the tag against the Expo application version, installs dependencies, and runs `npm run ci`.
2. `build` depends on `preflight`. It restores the Android signing key, generates the Android project, builds with Sentry upload disabled, verifies the APK's signing certificate, and uploads the APK as a private GitHub Actions artifact. It has read-only repository permissions and no public-release token.
3. `publish` depends on `build`, is disabled unless `ANDROID_PUBLIC_RELEASE_ENABLED=true`, and targets the `android-release-publish` GitHub environment. That environment must have required reviewers and contain the distribution approval evidence variables plus the cross-repository `RELEASES_TOKEN`. The job downloads the exact private artifact, validates the approval variables, and invokes the existing immutable publisher. The token is exposed only to the publishing step.
4. `notify` runs after the preceding jobs and reports the actual success, failure, cancellation, or skipped state of each job to Discord when `DISCORD_WEBHOOK_URL` is configured. It does not claim to distinguish an environment rejection from other publish failures because GitHub Actions does not expose a reliable distinct result for that case.

The workflow uses one `v*` trigger, concurrency group, secret schema, signing implementation, and release destination. A manual dispatch may rebuild an existing tag, but the immutable publisher rejects a different APK digest for an existing release.

## Validation Boundaries

`.github/scripts/validate-android-release.js` separates validation by trust boundary:

- Preflight validation checks the tag, application version, derived `versionCode`, and production URLs without receiving secrets.
- Build validation checks only the required Android signing values and expected certificate fingerprint.
- Publish validation checks that the protected environment provides an explicit approval flag and an HTTPS evidence URL before making the public release.

Each validator remains a pure function so the behavior can be covered by the existing Node test suite. Errors are emitted before the relevant expensive or irreversible operation.

## Security and Distribution Controls

- Every checkout uses `persist-credentials: false`.
- The tag-to-`main` check happens before any release secret is mapped into a step.
- The signing key is written only under `$RUNNER_TEMP`, with mode `0600`, and is not uploaded.
- `RELEASES_TOKEN` belongs to the protected publish environment and is mapped only for the final publisher invocation.
- The public release cannot proceed without `ANDROID_DISTRIBUTION_APPROVED=true` and an HTTPS `ANDROID_DISTRIBUTION_EVIDENCE_URL` from that environment.
- Repository administrators must configure required reviewers on `android-release-publish`; the workflow and PR documentation state that an unprotected environment does not satisfy the distribution gate.
- Public publishing is fail-closed at rollout. `ANDROID_PUBLIC_RELEASE_ENABLED` remains absent or false until an administrator verifies through the GitHub environment API that `android-release-publish` has required reviewers and the agreed deployment-branch/tag policy.
- `RELEASES_TOKEN` must not exist as a repository-scoped Actions secret. The current repository-secret inventory contains only `DISCORD_WEBHOOK_URL`; rollout instructions require rechecking that inventory and configuring `RELEASES_TOKEN` only as an `android-release-publish` environment secret.
- The expected signing certificate SHA-256 remains mandatory and is checked before artifact upload.

## Testing

Tests are added before workflow changes and must initially fail for the missing behavior. Coverage includes:

- strict tag validation and semantic version consistency;
- distinct preflight, signing-secret, and publish-approval validation;
- `main` ancestry verification occurring before secret-bearing steps;
- private artifact upload followed by protected artifact promotion;
- release token isolation to the final publish step;
- persisted checkout credentials remaining disabled;
- Sentry upload remaining disabled for the release build;
- Discord notification wiring;
- default-disabled public publishing and documented environment-protection cutover checks;
- immutable publishing behavior and signing plugin behavior already covered by PR #57.

Final verification consists of the focused Node test file, the full `npm run ci` suite, `expo prebuild`, Gradle configuration loading, workflow linting, and a final diff review. A real public release is intentionally not triggered during PR verification.

## Repository Operations

After verification, the implementation commits are pushed to `codex/android-release-automation`, updating PR #57. Its PR description is replaced with setup instructions for the protected environment, required secrets/variables, evidence gate, and validation performed. The instructions include commands to verify required-reviewer protection, confirm the absence of a repository-scoped `RELEASES_TOKEN`, and only then set `ANDROID_PUBLIC_RELEASE_ENABLED=true`. PR #56 is then closed as superseded with a short link to PR #57; no force-push or history rewrite is used.
