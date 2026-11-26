# Note Long Image PNG Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan inline, with test-driven-development and verification-before-completion.

**Goal:** Export the entire note as a self-contained PNG long image from the existing download menu.

**Architecture:** Keep the existing authenticated `POST /note/:id/exports` and `IMAGE` format. Build ordered export parts from the existing note layout and authorized media inventory, then render text and resized pictures with Sharp. Never fetch arbitrary note URLs. Videos use authorized posters or a static video placeholder.

**Tech Stack:** NestJS, TypeScript, Sharp, existing MinIO upload/download service, Jest, Expo frontend.

## Global Constraints

- Preserve existing frontend edits and the PDF/media archive formats.
- Include every selected image or fail explicitly; never silently drop media.
- Preserve repeated text/image regions, legacy notes, audio labels and location.
- Export no remarks, contact cards, account IDs or signed media URLs.
- Install CJK and emoji fonts in backend images.

## Task 1: PNG renderer

Files: backend `src/note/note-long-image.ts`, `src/note/note-long-image.spec.ts`, `package.json`, `package-lock.json`, `Dockerfile`, `Dockerfile.prod`.

- [x] Write failing raster tests for ordered images, wrapped/escaped text, video posters, missing media and output size limits.
- [x] Run `npm test -- --runInBand note-long-image.spec.ts` and verify the missing renderer failure.
- [x] Implement `renderNoteLongImage(title: string, parts: NoteLongImagePart[], loadImage: (key: string) => Promise<Buffer>): Promise<Buffer>` with text wrapping, full-aspect-ratio images, media chips, video play marks and an END footer. Apply existing byte limits at download and a bounded output pixel budget.
- [x] Run renderer tests and inspect a synthetic mixed-content PNG.

## Task 2: Existing export integration

Files: backend `src/note/note.service.ts`, `src/note/note.service.spec.ts`; frontend `src/features/notes/screens/NoteDetailScreen.tsx`, its behavior spec and `test/notes-screen.test.js`.

- [x] Test the endpoint's PNG MIME, `.png` filename, layout order and rejection of unowned media/posters. Update previous SVG assertions to inspect export parts.
- [x] Replace the SVG-only generator with ordered parts and the PNG renderer, preserving authorization, storage and stable artifact keys.
- [x] Keep the frontend menu open after denied/failed saves, report generation failures without exposing URLs, and test the existing IMAGE flow.
- [x] Run backend note service/renderer suites and TypeScript checks, then frontend targeted suites, typecheck and lint. Review diffs and verify all temporary processes have exited.

## Verification

- Backend: focused note/export suites passed, TypeScript passed, production build passed. Changed-file ESLint has zero errors and 9 pre-existing warnings.
- Frontend: 20 detail behavior tests and 75 note/API tests passed; typecheck and lint passed.
- A synthetic 1320 x 4115 PNG was rendered and visually inspected. Device album saving and deployed storage integration still need manual verification.
- Backend implementation is in the companion circle_be repository on codex/note-long-image-png. Deploy the backend before the frontend to replace SVG artifacts with PNG.

## Review corrections

- Decode accepted raw HEIC originals in a bounded worker with a real HEVC fixture regression.
- Keep coordinate-only locations and mirror detail-page legacy video ordering.
