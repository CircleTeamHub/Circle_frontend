# Group Notice Broadcast Implementation Plan

> Execute in the existing mobile branch. Backend publication to the current test environment was explicitly approved; prepare its scoped commit/PR in `test-results/group-notice-backend-release`, based on the running/main revision `e6505226ba205c253ac49881e9f27453f6dd78eb`. Preserve all unrelated dirty files and frontend work.

**Goal:** A manager-controlled group announcement switch shows a scrolling banner below the chat header for every member, for standalone and circle groups.

**Architecture:** Persist `ChatConversation.noticePinned` with default false. Extend the existing notice mutation to atomically update notice text and this flag for both group kinds, retaining existing manager authorization and announcement events. Serialize circle descriptions as the group's notice. Extract the existing profile announcement's presentation into a shared scrolling banner, retaining its motion/accessibility behavior.

**Tech Stack:** Expo/React Native, Zustand, existing i18n and group notice APIs; NestJS/Prisma/PostgreSQL backend at `C:/Users/93256/Desktop/WIndNote/circle_be_main`.

## Constraints

- No dependency additions, encoding settings into announcement text, or device-only switches.
- Ordinary members may read the banner and full notice; existing server-side manager checks govern writes.
- A cleared notice disables broadcast. A pin-only change must save, emit existing group-notice change notifications and update local state.
- Default false preserves existing groups. Add an additive database migration; do not change stored announcement text during migration.
- Reuse the profile banner's speed, overflow measurement, edge fades, reduced-motion behavior and animation cleanup.
- Keep all previous mobile fixes and unrelated backend push changes.

## Steps

- [x] Add failing backend checks for atomic text/pin changes, circle group support, unchanged requests, clearing, member denial and boolean validation. Extend schema, existing notice DTO/controller/service and conversation serialization; generate Prisma types and verify targeted backend tests/build.
- [x] Add failing mobile checks for switch-only saves, both group routes, failure retention, empty notices and live banner visibility. Extend the notice API contract and route params; update the editor and group-info local state.
- [x] Extract `src/components/ui/scrolling-announcement-banner.tsx` from the existing profile banner. Add `GroupNoticeBanner`, place it below the chat header, and verify profile scroll/lifecycle regressions and group updates.
- [x] Add five-locale copy, run focused tests, TypeScript/lint and diff checks, prepare the backend migration/release changes, build the test APK and verify the available native flows without publishing real group announcements for QA. Stop owned temporary processes.

## Release verification

- Backend PR #307 merged as `6235216d92ef13d2708604443e3a4ed159a9e626`; PR CI and main CI, security scans, image build, Auto Release and Release all passed.
- Server active `circle-be-green` is healthy and its image revision matches the merge commit; public liveness returns OK and unauthenticated conversation access returns 401.
- Migration applied once; `noticePinned` is non-null boolean with default false; existing pinned group count remained zero.
- Phone test package installed with data preserved; installed APK SHA-256 verified. Native editor disabled-empty, enabled-draft, toggle-on, back/discard and re-entry checks passed; returned to the group chat with no fatal app errors.
- Native QA used only an unsaved draft. Real announcement publication and the enabled banner's full member flow are covered by automated behavior/service tests; no real group announcement was sent for QA.
- Owned temporary build/test/SSH/shell processes have exited; shared ADB and the requested test app remain available.
- After release, the clean backend worktree was relocated to `.codex-worktrees/group-notice-backend-release` and its Git registration repaired, so the frontend TypeScript glob does not scan backend source under `test-results`.
