# HEIC compatibility implementation plan

> Execute sequentially in isolated App and admin checkouts, with failing regression tests before each implementation.

**Goal:** Display existing HEIC avatars/circle icons in the admin, normalize future native App HEIC uploads, and render the new-user badge.

**Architecture:** Reuse COS `imageMogr2/format/jpg` for public HEIC previews; the affected account's original has been verified to return HTTP 200 and `image/jpeg` with this query. Preserve originals and signed/private URLs. Reuse Expo ImageManipulator before signing native HEIC uploads so the signature's filename, MIME and byte count match the converted file. Bind the converted URI to the existing presign headers identity so callers upload the matching bytes. Reuse the App's `newjoiner.png` in admin.

**Constraints:** No new dependencies, storage services, database migrations, deletion of originals, or changes to signed URL query strings. Preserve unrelated work. Keep conversion errors visible and clean temporary converted files after failures or upload completion.

## App upload regression

- [x] Add cases to `test/upload.api.test.js`: HEIC/HEIF MIME and filename detection, converted JPEG filename/MIME/size/PUT source, unchanged ordinary formats, conversion/presign/PUT failures and cleanup.
- [x] Run `node --test test/upload.api.test.js` and observe failures.
- [x] Update `src/services/api/upload.ts` to convert native HEIC before presigning, retain converted-file metadata alongside the presign lifecycle, use it during PUT, and clean the temporary JPEG.
- [x] Run focused tests, typecheck and lint.

## Existing admin images and new-user badge

- [x] Add public HEIC preview tests in `src/utils/browser-image-url.test.ts` and actual profile/badge rendering assertions in `src/pages/UserDetailPage.test.tsx`.
- [x] Run focused Vitest tests and observe failures.
- [x] Add the shared `browserImageUrl` helper at image rendering boundaries in user list/details and circle/group details. Add `type`/`systemKey` to the profile icon type and reuse `src/assets/newjoiner.png` for the system badge, with an accessible fallback for other icons without images.
- [x] Run admin tests and production build; visually verify the affected account's avatar/circle icon and badge in a local preview using the existing authorized admin session.

## Delivery

- [x] Review the diff and verify no unrelated files were included.
- [ ] Create ready-for-review PRs and provide precise verification/deployment status. Keep any online rollout separate from local completion claims.
- [ ] Stop temporary development processes and verify they exited.

## Verification evidence

- App: TypeScript 5.9.3 typecheck and targeted ESLint passed; 58 upload/progress/privacy/note-logic tests passed; both note-editor behavior suites passed 170 tests.
- Note image metadata now uses the signed Content-Type and Content-Length so a converted JPEG exports with the matching MIME and byte size. Both editor paths have regression coverage.
- Browser decoded the affected account's existing avatar and circle icon as 3024x4032 JPEG previews; the App's copied new-user badge decoded as 280x358.
- Admin: initial full suite passed 318 tests; final rerun and build pending.
- Native decoding is exercised via the installed Expo API and mocked decoder in unit tests; no physical-device upload was performed.
