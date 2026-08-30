# Tencent COS Android Preproduction CD Migration Plan

**Goal:** Replace Cloudflare R2 with the existing Tokyo Tencent COS bucket for the verified Android preproduction APK while preserving immutable builds, a stable public download, byte verification, and automatic rollback.

**Architecture:** The Android build job remains unchanged and produces a checksum-verified private Actions artifact. The publish job installs the pinned Tencent COSCLI v1.0.8 binary after validating Tencent's published SHA256, uploads a commit-addressed private object with overwrite protection, promotes it to one object-level `public-read` alias, verifies authenticated and public bytes, and restores the previous alias on failure. The bucket itself remains private so application media is not exposed. The website changes only after the COS URL is live.

**Scope:** `CircleTeamHub/Circle_frontend` and `CircleTeamHub/Circle_Web`.

## Safety constraints

- Never print or commit the Tencent SecretId or SecretKey.
- Store credentials only as `TENCENT_COS_SECRET_ID` and `TENCENT_COS_SECRET_KEY` GitHub Actions secrets.
- Keep `windnote-preprod-tokyo-1447743949` private; grant `public-read` only to `android/preprod/latest/windnote.apk`.
- Limit the publisher CAM user to the `android/preprod/*` prefix and the object operations required by upload, head, get, copy, delete, and object ACL headers.
- Do not delete the working R2 object until the COS object and both website locales are independently verified.
- Queue `main` publications instead of cancelling an in-progress promotion.

## Task 1: Establish failing COS publication contracts

**Files:**

- Modify: `test/android-preprod-build-workflow.test.js`
- Modify: `Circle_Web/src/config/downloads.test.ts`
- Modify: `Circle_Web/tests/e2e/site.spec.ts`

- Require Tencent credentials only in the publish step.
- Require the Tokyo bucket, endpoint, stable public URL, pinned COSCLI release and checksum.
- Require the publisher to use commit-addressed keys, overwrite protection, object-level `public-read`, authenticated/public byte hashing, and rollback.
- Reject R2 credentials, R2 endpoints, and AWS CLI commands.
- Require the website fallback and end-to-end download URL to use Tencent COS.
- Run focused tests and record the expected RED failures.

## Task 2: Implement the COS publisher

**Files:**

- Add: `.github/scripts/publish-android-preprod-cos.sh`
- Modify: `.github/workflows/android-preprod-build.yml`
- Modify: `docs/android-release.md`

- Check out the selected commit in the publish job so the reviewed publisher script is used.
- Download Tencent COSCLI v1.0.8 from the versioned official GitHub release URL and verify SHA256 `7165f2ae16c5f7ac495864c963ca574a76e04ec72680d7bc8a8eee3234d8cf91` before execution.
- Upload `android/preprod/builds/${GITHUB_SHA}/windnote.apk` with private ACL and overwrite protection.
- Verify immutable object size and SHA256 by authenticated download before touching `latest`.
- Snapshot an existing latest object to a run-addressed rollback key.
- Copy the verified object to `android/preprod/latest/windnote.apk` with object-level `public-read`, APK headers, a five-minute cache, and SHA256 metadata.
- Verify latest through authenticated COS download and unauthenticated HTTPS download.
- Restore or remove latest on any post-promotion failure, then clean the temporary rollback object on success.

## Task 3: Point the website at COS

**Files:**

- Modify: `Circle_Web/src/config/downloads.ts`
- Modify: `Circle_Web/src/config/downloads.test.ts`
- Modify: `Circle_Web/tests/e2e/site.spec.ts`
- Modify: `Circle_Web/README.md`

- Bind a custom COS origin or CDN domain because Tencent blocks APK downloads on the default `*.myqcloud.com` domain, then configure that URL through `TENCENT_COS_PUBLIC_APK_URL` and the website environment.
- Preserve the environment override and the fail-soft build-time probe behavior.

## Task 4: Verify and deploy in dependency order

- Run the focused app workflow contract test and website download tests.
- Run `npm run licenses:check` and `npm run ci` in the app repository.
- Run `npm run check`, `npm test`, and the production website build in the website repository.
- Review both diffs for credential exposure, bucket-wide public access, and rollback regressions.
- Create ready-for-review PRs.
- Add the two Tencent credential values to GitHub Actions without echoing them.
- Merge the app PR first and wait for a successful `main` workflow.
- Compare the Actions artifact SHA256 with the public COS object and verify its headers.
- Merge the website PR only after the COS URL is reachable.
- Verify the deployed Chinese and English pages link to the COS object.
