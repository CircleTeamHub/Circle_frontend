# 2026-04-09 Note Backend

## Goal

Implement a backend-only private note module in `/Users/yiboding/projects/circle_be` for personal notes with text, multiple images, multiple videos, groups, pinning, and active/unlisted/deleted status.

## Target Files

- Create: `/Users/yiboding/projects/circle_be/src/note/note.module.ts`
- Create: `/Users/yiboding/projects/circle_be/src/note/note.controller.ts`
- Create: `/Users/yiboding/projects/circle_be/src/note/note.service.ts`
- Create: `/Users/yiboding/projects/circle_be/src/note/dto/note.dto.ts`
- Create: `/Users/yiboding/projects/circle_be/src/note/note.service.spec.ts`
- Create: `/Users/yiboding/projects/circle_be/src/note/dto/note.dto.spec.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/app.module.ts`
- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/20260409190000_notes/migration.sql`
- Modify: `/Users/yiboding/projects/circle_be/src/upload/dto/presign.dto.ts`
- Modify: `/Users/yiboding/projects/circle_be/docs/frontend-api-guide.md`

## Tasks

### 1. Schema + upload surface

- Add enums `NoteStatus` and `NoteMediaType`.
- Add models `Note`, `NoteMedia`, `NoteGroup`.
- Add `User` relations for owned notes and note groups.
- Extend upload folder allowlist with `notes`.

### 2. Test-first service behavior

- Write failing service tests for:
  - create note with mixed media and derived counts
  - list notes with summary payload
  - get note detail with ordered media
  - update note replacing media and cover
  - pin/unpin note
  - soft delete note
  - create/list/delete groups
  - forbidding cross-user access
- Write failing DTO validation tests for:
  - media payload validation
  - title length
  - valid status and media type enums

### 3. Module implementation

- Implement `NoteService` with owner-only access and transaction-wrapped create/update.
- Implement `NoteController` routes:
  - `GET /note`
  - `GET /note/:id`
  - `POST /note`
  - `PATCH /note/:id`
  - `PATCH /note/:id/pin`
  - `DELETE /note/:id`
  - `GET /note/group`
  - `POST /note/group`
  - `PATCH /note/group/:id`
  - `DELETE /note/group/:id`
- Wire `NoteModule` into `AppModule`.

### 4. Documentation + verification

- Document note endpoints in `frontend-api-guide.md`.
- Run:
  - `pnpm test src/note/note.service.spec.ts src/note/dto/note.dto.spec.ts --runInBand`
  - `pnpm exec tsc --noEmit`
  - `pnpm prisma generate`

