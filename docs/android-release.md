# Android release rollout

This runbook is fail-closed. PR #57 and `.github/workflows/android-release.yml` are the only canonical workflow for Android releases. PR #56 must not merge. Do not copy or retain a second release workflow.

## Pipeline contract

The ordered pipeline is: secret-free preflight → signed and certificate-verified private artifact retained for 30 days → default-disabled protected promotion → best-effort Discord notification. Preflight validates the exact tag, its commit, release metadata, ancestry from `main`, and application checks without reading secrets. Build signs the APK, checks its certificate fingerprint, generates its checksum, and uploads only the private Actions artifact. Promotion downloads that artifact, verifies the checksum and distribution evidence, and is skipped unless explicitly enabled. Discord runs last with `always()` and cannot change the release result.

PR #57 does not by itself authorize public distribution. A successful private build is not evidence that the legal or promotion gates passed.

## Repository configuration

Configure metadata and signing for the private build without putting secret values in documentation, logs, issues, or pull requests.

The current preproduction candidate is Android `v1.0.1` (`versionCode` `1000001`). Its test deployment contract is:

- API and chat fallback: `https://api-43-133-201-42.sslip.io`
- media origin: `https://windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com`

These values identify the Tokyo test stack, not production. A preproduction workflow must verify both expected hostnames are embedded and that obsolete tunnel/OpenIM hostnames are absent before retaining its private artifact.

## Preproduction APK

`.github/workflows/android-preprod-build.yml` is the controlled Android inner-test path. It runs automatically for every push to `main`; `workflow_dispatch` remains available for an explicit rebuild of the exact commit selected in the Actions ref picker. Only a run whose ref is `refs/heads/main` may publish to the website download channel. Runs are queued instead of cancelled so a verified artifact cannot be interrupted during promotion; the stable website object is updated only after every build and byte-level verification succeeds.

The test APK is a separately installable application named `风信测试版` with package ID `com.yiboding.circleim.preprod`. It registers and generates only the dedicated `windnoteai-preprod` / `circleim-preprod` deep-link schemes, while its in-app scanner can still parse legacy QR payloads. It may use the existing signing certificate, but its different package ID prevents it from overwriting the formal `com.yiboding.circleim` app. It also does not read the formal APK update manifest, so an inner-test install cannot offer or install the production package as its own update.

The first build with the `.preprod` package ID is an intentional one-time cutover, not an in-place upgrade. Existing testers must uninstall the old website APK that used `com.yiboding.circleim`, install `风信测试版` from the refreshed test URL, and sign in again; its local session/database cannot migrate across Android package IDs. Do not keep using the old install: it shares production identity and still contains the old production-update behavior. The website/operator announcement for this cutover must say “卸载旧测试版、安装风信测试版、重新登录” before the stable object is promoted.

The workflow validates the exact `v1.0.1` metadata and Tokyo endpoint contract, checks the generated dependency notices/SBOM, runs the full application CI, signs the APK, then verifies its certificate, package ID, version, and embedded endpoints. A distributable test build fails closed when `EXPO_PUBLIC_SENTRY_DSN` is absent or malformed. It deliberately sets `SENTRY_DISABLE_AUTO_UPLOAD=true`: runtime crash reporting remains enabled through the DSN, but a preproduction build must not create a production Sentry release or upload source maps. The canonical tagged public-release path does not set that opt-out and remains fail-closed on its complete Sentry configuration.

The successful build retains one private Actions artifact named `android-preprod-v1.0.1` for 30 days. It contains:

- `windnote-preprod-v1.0.1.apk`
- `windnote-preprod-v1.0.1.apk.sha256`
- `THIRD_PARTY_NOTICES.txt`
- `cyclonedx-sbom.json`

The separate publish job downloads that exact artifact and verifies its checksum before receiving any R2 credentials. It creates the commit-addressed object at `android/preprod/builds/<commit SHA>/windnote.apk` only when absent; a rerun never overwrites it and must prove its downloaded bytes have the candidate checksum. Before promotion it saves the current stable object, copies the verified object to `android/preprod/latest/windnote.apk`, and verifies the R2 versioned object, R2 stable object, and public download byte-for-byte. Any post-promotion failure restores the previous stable object (or removes the first unverified stable object). The website uses the stable URL:

`https://pub-9d36120697ca455b9fb0e430da8b9481.r2.dev/android/preprod/latest/windnote.apk`

This URL is public and unauthenticated: anyone who knows it can download the preproduction APK. The `r2.dev` hostname is suitable for the current inner test, but move the stable object behind a custom R2 domain before broad production traffic. This preproduction path is intentionally separate from the formal `android/latest/windnote.apk` channel. It does not create a GitHub Release, does not enable `ANDROID_PUBLIC_RELEASE_ENABLED`, and is not evidence that the formal legal distribution gate below passed. To roll back deliberately, copy a previously verified commit-addressed object to the preproduction `latest` key; never rebuild or mutate an old commit-addressed object.

To start the candidate after the reviewed commit is pushed:

```sh
gh workflow run .github/workflows/android-preprod-build.yml --ref main
```

Record the run URL, commit SHA, certificate fingerprint, and checksum with the inner-test record. A failed metadata, CI, signing, identity, endpoint, or checksum check is a stop condition; do not substitute a locally signed APK.

- Repository variable `EXPO_PUBLIC_API_URL`: production HTTPS API base URL, without embedded credentials.
- Repository variable `EXPO_PUBLIC_CHAT_WS_URL` (optional): WSS origin of the chat gateway
  when it is not served from the API origin. Repository variables are not injected into
  `process.env` automatically — without this the build silently compiles the API-origin
  fallback and ships with REST working but the chat socket unable to connect at all.
- Repository variable `EXPO_PUBLIC_MEDIA_ORIGINS` (required for release candidates, comma-separated): extra
  object-storage / CDN origins that serve chat media. The upload contract returns an
  independent `fileUrl`, so when storage lives on its own hostname it must be listed here —
  otherwise the peer-media allowlist rejects every legitimate URL and images, voice notes,
  and share covers all come back blank while REST keeps working. Only the listed origins are
  trusted; the allowlist still blocks arbitrary third-party hosts (tracking beacons).
- Repository variable `ANDROID_CERT_SHA256`: expected signing certificate SHA-256 fingerprint.
- Repository variable `EXPO_PUBLIC_SENTRY_DSN`: production Sentry DSN compiled into the app.
  It is not a secret, but must point to the intended production project.
- Repository variable `SENTRY_ORG`: Sentry organization slug used only by the release build.
- Repository variable `SENTRY_PROJECT`: Sentry project slug used only by the release build.
- Repository secret `SENTRY_AUTH_TOKEN`: least-privilege token that can upload release source maps.
- Repository secret `ANDROID_KEYSTORE_BASE64`: base64-encoded release keystore.
- Repository secret `ANDROID_KEYSTORE_PASSWORD`: release keystore password.
- Repository secret `ANDROID_KEY_ALIAS`: signing key alias.
- Repository secret `ANDROID_KEY_PASSWORD`: signing key password.

`RELEASES_TOKEN` must not be repository-scoped. It is a promotion credential and, if promotion becomes supportable, belongs only to the protected `android-release-publish` environment. A Discord webhook is optional; notification is best-effort.

Keep an encrypted, access-controlled, tested keystore backup separate from GitHub. Losing the signing keystore or its credentials can prevent safe upgrades; never regenerate it casually for an existing application identity.

The signed release job fails closed when any Sentry value above is missing. It uses
`windnote@<release-tag>` as both the build-time and runtime Sentry release, and the Android
`versionCode` as both build-time and runtime `dist`. The Sentry Gradle task must complete during
`assembleRelease`; an upload failure fails the build, so a published binary cannot silently lose
symbolication. Do not print the auth token or copy it into Expo public variables.

Source-map upload policy:

- tagged signed release: required and fail-closed;
- nightly validation build: disabled, because it is not distributable and would pollute releases;
- local debug/release build: disabled unless a developer deliberately supplies the complete
  Sentry upload configuration for a controlled verification.

## Current verified blocker

The current verified organization plan is CircleTeamHub GitHub Free. The `CircleTeamHub/Circle_frontend` repository is private. On this plan, GitHub required reviewers are unavailable for this private repository, and environment secrets are unavailable for this private repository. Therefore the protected promotion design cannot presently be enforced.

`ANDROID_PUBLIC_RELEASE_ENABLED` must remain absent or false. Public promotion is unavailable. Do not bypass the gate with a repository token, a personal local upload, a duplicate workflow, or an unprotected environment. A private, signed Actions artifact may still be produced for controlled verification, but it is not approval to distribute the binary.

**Workflow enforcement status.** The `publish` job in `.github/workflows/android-release.yml` now carries `if: vars.ANDROID_PUBLIC_RELEASE_ENABLED == 'true'`, so the default-disabled promotion described above is enforced by the workflow itself: with the variable absent or not `'true'`, a `v*` tag push ends at the private artifact and `publish`/R2 upload are skipped (issue #84 closed this doc-vs-workflow gap). The job additionally runs `validate-android-release.js distribution` before any publishing step, requiring the repository variables `ANDROID_DISTRIBUTION_APPROVED=true` and a credential-free HTTPS `ANDROID_DISTRIBUTION_EVIDENCE_URL` — a single mis-set `ANDROID_PUBLIC_RELEASE_ENABLED` can no longer ship a public APK without automated evidence validation. Two deviations from the full design remain and are tracked, not hidden: (1) `RELEASES_TOKEN` currently exists at repository scope and is read directly by the job — on the current plan there is no protected environment to move it into; migrate it to the `android-release-publish` environment when the plan allows, then delete the repository-scoped copy. (2) Required reviewers / environment protection remain unavailable on the current plan, so enabling the variable is a single-administrator action; treat setting it as the release-approval act itself.

Verify the blocker from an authenticated `gh` session:

```sh
gh api orgs/CircleTeamHub --jq '.plan.name'
gh api repos/CircleTeamHub/Circle_frontend --jq '.visibility'
gh secret list --repo CircleTeamHub/Circle_frontend
gh api repos/CircleTeamHub/Circle_frontend/environments/android-release-publish
gh api repos/CircleTeamHub/Circle_frontend/environments/android-release-publish/deployment-branch-policies
```

The first two commands must show a plan with the needed private-repository environment capabilities and the expected visibility before enablement is considered. The secret inventory must confirm there is no `RELEASES_TOKEN` at repository scope; the command lists names only and must never be used to expose values. Inspect the environment response for required reviewers, `prevent_self_review`, and its deployment branch/tag policy. Inspect the deployment policy response for an allowlisted tag pattern such as `v*`, not an unrestricted branch or tag. A 404 from either environment command, or the current plan result, means do not enable public promotion.

## Future enablement gate

Revisit promotion only after GitHub can enforce the complete design. Capability may come from Enterprise required reviewers for a private repo, or from a deliberate visibility decision that has received its own security, legal, and operational review. Visibility must never be changed merely to make this workflow pass.

Before setting `ANDROID_PUBLIC_RELEASE_ENABLED=true`, all of the following must be true:

1. The `android-release-publish` environment has required reviewers, prevent self-review enabled, and a deployment tag policy that admits only the approved release tag pattern (normally `v*`).
2. The environment-only `RELEASES_TOKEN` secret is in `android-release-publish`, is absent from repository secrets, and has only the permissions needed to publish to `CircleTeamHub/windnote-releases`.
3. The environment variable `ANDROID_DISTRIBUTION_APPROVED=true` records the approval state for that gate.
4. The environment variable `ANDROID_DISTRIBUTION_EVIDENCE_URL` is an HTTPS URL without embedded credentials and points reviewers to the complete, version-specific evidence package.
5. The legal evidence gate below passes for the exact build SHA and release tag.
6. The verification commands above show the expected protection and deployment policy. A missing policy, missing reviewer, self-review, 404, or unsupported plan is a stop condition.

Only after an authorized reviewer confirms every condition may a repository administrator set the repository variable `ANDROID_PUBLIC_RELEASE_ENABLED=true`. Remove or set it to false immediately when any condition stops being true.

## Legal evidence gate

The legal gate is inherited from `docs/production-readiness-and-capacity-plan.md`. Its evidence package must include all of the following for the candidate binary:

- an SBOM / dependency list with exact direct and transitive component versions and sources;
- the applicable LICENSE and NOTICE materials;
- a patch list describing local modifications and packaging/linking treatment;
- a qualified legal written decision covering the intended channel and jurisdiction;
- the exact build SHA;
- vendor authorization when applicable, or a written decision from qualified counsel that it is not applicable.

The decision must address notice, source-offer, attribution, modification-disclosure, relicensing, and commercial-license obligations as applicable. Missing evidence is NO-GO. This repository and this runbook do not claim that legal approval exists.

## Daily pre-release validation

`.github/workflows/daily-android-build.yml` runs the native release path against `main` every night at 02:00 Asia/Shanghai, and on demand via `workflow_dispatch` — a manual run builds whichever ref you select, so a branch can be validated before it lands.

It exists because nothing else exercises that path before a tag. `ci.yml` stops at typecheck, lint, tests, and `expo export --platform web`; `/android` is gitignored, so the native project only comes into existence when `expo prebuild` regenerates it from `app.config.js` and its config plugins. Without this workflow, a bumped native dependency, a broken config plugin, or an AGP/Gradle incompatibility first surfaces during a release, when the only remedy is to abandon the tag.

The daily build publishes nothing. It uploads no artifact, creates no release, writes nothing to R2, and does not upload Sentry source maps. Its APK is signed with a throwaway key generated on the runner and deleted with it, because `plugins/with-android-release-signing.js` fails the Gradle configuration phase when signing material is absent — production signing material is never decoded by this workflow. A separate `signing_config` job runs `validate-android-release.js signing` so a rotated, deleted, or malformed signing credential surfaces here rather than during a release.

Before building, it runs `validate-android-release.js build-env` — the same env contract the tag-time preflight enforces via `metadata`, minus the `RELEASE_TAG` checks. Without it a deleted or malformed repository variable would let the build compile the `imAdmin` support fallback with empty API URLs and still report success.

The build fails when `assembleRelease` produces no APK, and when it produces no R8 mapping despite `enableMinifyInReleaseBuilds`; a release build that silently stops minifying would otherwise still report success. Failures and cancellations notify Discord; successes are silent by design, so the daily signal stays worth reading.

A red daily build is a release blocker. Fix `main` first — do not push a `v*` tag against a commit whose native build is known broken.

## Prepare and start a release

1. Choose a strict stable semver `major.minor.patch`: three non-negative decimal integers, no leading zeroes except `0`, and no prerelease/build suffix. Minor and patch must each be below 1000.
2. Update `app.json` so `expo.version` is exactly `major.minor.patch` and `expo.android.versionCode` follows `versionCode = major * 1,000,000 + minor * 1,000 + patch`.
3. Merge the reviewed release changes to `main`, synchronize locally, and create the `vmajor.minor.patch` tag on that exact commit on `main`. Confirm the tag commit is an ancestor of `origin/main`.
4. Choose exactly one trigger path below: push a new `v*` tag, or use `workflow_dispatch` only when re-running an already-existing tag. The manual input for an existing tag is a tag name, not an arbitrary branch or SHA.

Replace the example version, but do not move an existing tag.

### New release

Use this path once for a version whose tag does not yet exist:

```sh
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git tag -a v1.2.3 -m 'Android v1.2.3'
git push origin v1.2.3
```

### Existing tag rerun

Use this alternative path only to rerun a tag that already exists; do not push or recreate the tag. Both `--ref` and `release_tag` must name that same tag so the protected environment evaluates the `v*` tag deployment policy:

```sh
gh workflow run .github/workflows/android-release.yml --ref v1.2.3 -f release_tag=v1.2.3
```

Publishing is immutable by digest. A rerun may reuse `windnote.apk` only when its recorded SHA-256 digest equals the candidate artifact. A different digest for the same release tag is a hard failure, not permission to overwrite the asset.

## Verify the release

Open the GitHub Actions run and record the Actions jobs/results for `preflight`, `build`, `publish`, and `notify`. Expected outcomes under the current fail-closed configuration are successful preflight and build, skipped publish, and a notify result that cannot fail the release.

For the exact candidate:

- confirm the checked-out tag and reported commit equal the intended build SHA on `main`;
- compare the `apksigner` certificate fingerprint with repository variable `ANDROID_CERT_SHA256`;
- confirm the build log completed the Sentry source-map upload and that Sentry shows release
  `windnote@<release-tag>` with `dist=<android versionCode>`; do not expose the auth token while
  collecting this evidence;
- download the private artifact and validate the artifact checksum with `sha256sum -c windnote.apk.sha256`;
- when legally permitted, perform an APK install on a clean supported device and verify launch, authentication, API calls, OpenIM WebSocket behavior, and backend connectivity against the intended production HTTPS/WSS endpoints;
- if public promotion is enabled in the future, confirm the public `windnote.apk` digest equals the private artifact digest and preserve the evidence URL and reviewer decision with the release record.

Do not treat Discord delivery as verification. It is only an observable, best-effort summary.

## Rollback and incident handling

To stop promotion, disable `ANDROID_PUBLIC_RELEASE_ENABLED` by removing it or setting it to false. Cancel any run that has not passed the protected environment, revoke the environment-only token if exposure is suspected, and preserve the Actions logs and evidence for review.

Never overwrite or move a published tag. Never replace an asset with different bytes under the same tag. Correct the problem, increment the application versions, and publish a new higher semver tag through the complete pipeline. If signing material may be compromised, stop releases and follow the key-rotation/application-identity procedure before building again; verify the encrypted keystore backup before relying on it.
