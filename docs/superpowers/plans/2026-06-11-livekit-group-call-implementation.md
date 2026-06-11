# LiveKit Group Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first LiveKit Cloud-backed group call MVP for Circle IM.

**Architecture:** `circle_be` owns call state, group membership validation, realtime invite events, and LiveKit token minting. `circle-im` calls only `circle_be`, receives `{ livekitUrl, token }`, and uses LiveKit React Native SDK in a minimal group audio call UI. LiveKit Cloud can later be replaced by self-hosted LiveKit by changing backend config only.

**Tech Stack:** NestJS 11, Prisma 7, Jest, Expo 55, React Native 0.83, Zustand, LiveKit React Native SDK.

---

## Baseline

- Frontend worktree: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im`
- Backend worktree: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be`
- Backend baseline: `npm test -- --runInBand` passes with 66 suites / 407 tests.
- Frontend baseline: `npm run lint` fails before this feature due existing `react-hooks/rules-of-hooks` errors in `src/features/discover/screens/CreateCircleScreen.tsx` and `src/features/discover/screens/InvitationVerificationScreen.tsx`.
- Backend `npm ci` fails before this feature because `package.json` and `package-lock.json` are already out of sync for `mongodb`; `npm install` updates the lockfile and generates Prisma client.

---

## File Map

### Backend

- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/package.json`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/package-lock.json`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/prisma/schema.prisma`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/prisma/migrations/20260611030000_add_call_sessions/migration.sql`
- Modify generated: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/generated/prisma/*`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/app.module.ts`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/config/env.validation.ts`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/realtime/realtime.service.ts`
- Modify test: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/realtime/realtime.service.spec.ts`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/call/call.module.ts`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/call/call.controller.ts`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/call/call.service.ts`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/call/livekit.service.ts`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/call/dto/call.dto.ts`
- Create test: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/call/call.service.spec.ts`
- Create test: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/call/livekit.service.spec.ts`
- Create test: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle_be/src/call/call.controller.spec.ts`

### Frontend

- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/package.json`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/package-lock.json`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/app.json`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/app/_layout.tsx`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/src/features/call/types.ts`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/src/features/call/store/use-call-store.ts`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/src/features/call/store/use-call-store.test.mts`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/src/features/call/components/CallInviteHost.tsx`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/src/services/api/calls.ts`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/src/realtime/client.ts`
- Modify: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/src/features/chat/screens/ChatDetailScreen.tsx`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/app/(chat)/group-call.tsx`
- Create: `/Users/yiboding/.codex/worktrees/livekit-group-call/circle-im/src/features/call/screens/GroupCallScreen.tsx`

---

## Task 1: Backend Data Model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260611030000_add_call_sessions/migration.sql`
- Regenerate: `src/generated/prisma/*`

- [x] **Step 1: Add Prisma schema test through generation**

Run: `npm run prisma:generate`

Expected before schema change: PASS with no `CallSession` model in generated client.

- [x] **Step 2: Add call enums and models**

Add enums `CallType`, `CallStatus`, `CallParticipantStatus`, `CallEndReason`, plus `CallSession` and `CallParticipant` with indexes from the design.

- [x] **Step 3: Add SQL migration**

Create SQL migration for enum types, `CallSession`, `CallParticipant`, indexes, and FKs to `User`.

- [x] **Step 4: Regenerate Prisma client**

Run: `npm run prisma:generate`

Expected: generated client contains `CallSession`, `CallParticipant`, and call enums.

- [x] **Step 5: Run backend tests**

Run: `npm test -- --runInBand`

Expected: PASS.

---

## Task 2: Backend LiveKit Service

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config/env.validation.ts`
- Create: `src/call/livekit.service.ts`
- Create: `src/call/livekit.service.spec.ts`

- [x] **Step 1: Write failing tests**

Test cases:
- missing `LIVEKIT_URL`, `LIVEKIT_API_KEY`, or `LIVEKIT_API_SECRET` makes `assertConfigured()` throw `ServiceUnavailableException`;
- `mintJoinToken()` uses microphone-only grants for audio calls;
- `mintJoinToken()` uses microphone + camera grants for video calls;
- `deleteRoom()` swallows provider delete failures after logging.

Run: `npm test -- call/livekit.service.spec.ts --runInBand`

Expected: FAIL because file/service does not exist.

- [x] **Step 2: Install dependency**

Run: `npm install livekit-server-sdk`

Expected: package and lockfile updated.

- [x] **Step 3: Implement service**

Wrap `RoomServiceClient`, `AccessToken`, and `TrackSource` in a small Nest service. Use `ConfigService`; do not read env directly outside constructor.

- [x] **Step 4: Verify**

Run: `npm test -- call/livekit.service.spec.ts --runInBand`

Expected: PASS.

---

## Task 3: Backend Realtime Call Events

**Files:**
- Modify: `src/realtime/realtime.service.ts`
- Modify: `src/realtime/realtime.service.spec.ts`

- [x] **Step 1: Write failing tests**

Add tests for:
- `broadcastCallInvite()` sends `call.invite`;
- `broadcastCallParticipantJoined()` sends `call.participant.joined`;
- `broadcastCallEnded()` sends `call.ended`.

Run: `npm test -- realtime/realtime.service.spec.ts --runInBand`

Expected: FAIL because methods do not exist.

- [x] **Step 2: Implement methods and event type union**

Keep payloads typed, small, and token-free.

- [x] **Step 3: Verify**

Run: `npm test -- realtime/realtime.service.spec.ts --runInBand`

Expected: PASS.

---

## Task 4: Backend Call Service

**Files:**
- Create: `src/call/dto/call.dto.ts`
- Create: `src/call/call.service.ts`
- Create: `src/call/call.service.spec.ts`

- [x] **Step 1: Write failing service tests**

Test cases:
- creating a group call trims/dedupes invitees, rejects empty invitee list, creates one `CallSession` plus participants;
- creator must be verified group member;
- mapped Circle group validates local `circleMember` active status;
- raw OpenIM group validates membership with `openim.isGroupMember`;
- participant limit returns `BadRequestException`;
- `acceptCall()` only allows invited participant, marks them joined, returns LiveKit token;
- `rejectCall()` only affects current participant;
- `leaveCall()` ends call when no joined participants remain.

Run: `npm test -- call/call.service.spec.ts --runInBand`

Expected: FAIL because service does not exist.

- [x] **Step 2: Implement minimal service**

Follow existing `GroupService` membership normalization:
- `sg_` conversation IDs map to raw OpenIM group IDs by stripping `sg_`;
- mapped Circle groups use `circle` and `circleMember`;
- raw groups use `openim.isGroupMember()`.

- [x] **Step 3: Verify**

Run: `npm test -- call/call.service.spec.ts --runInBand`

Expected: PASS.

---

## Task 5: Backend Controller and Module

**Files:**
- Create: `src/call/call.controller.ts`
- Create: `src/call/call.controller.spec.ts`
- Create: `src/call/call.module.ts`
- Modify: `src/app.module.ts`

- [x] **Step 1: Write failing controller tests**

Test cases:
- controller uses `JwtGuard` and `ThrottlerGuard`;
- `POST /calls/group` passes `req.user.userId` to service;
- accept/reject/leave/cancel/join-token pass `callId` and current user to service.

Run: `npm test -- call/call.controller.spec.ts --runInBand`

Expected: FAIL because controller does not exist.

- [x] **Step 2: Implement controller/module**

Use `/calls` route prefix and DTO validation decorators. Register `CallModule` in `AppModule`.

- [x] **Step 3: Verify backend**

Run:
- `npm test -- call realtime --runInBand`
- `npm test -- --runInBand`
- `npm run build`

Expected: PASS.

---

## Task 6: Frontend Call Store and API

**Files:**
- Create: `src/features/call/types.ts`
- Create: `src/features/call/store/use-call-store.ts`
- Create: `src/features/call/store/use-call-store.test.mts`
- Create: `src/services/api/calls.ts`
- Modify: `src/realtime/client.ts`

- [x] **Step 1: Write failing store tests**

Test cases:
- `call.invite` stores active incoming invite;
- `call.participant.joined` updates participant status;
- `call.ended` clears active call.

Run: `node --test src/features/call/store/use-call-store.test.mts`

Expected: FAIL because store does not exist.

- [x] **Step 2: Implement types, store, API client**

Add `createGroupCall`, `acceptCall`, `rejectCall`, `leaveCall`, `cancelCall`, and `requestJoinToken`.

- [x] **Step 3: Wire realtime client**

Parse call events and dispatch to `useCallStore`.

- [x] **Step 4: Verify**

Run: `node --test src/features/call/store/use-call-store.test.mts`

Expected: PASS.

---

## Task 7: Frontend Minimal Group Call UI

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app.json`
- Modify: `app/_layout.tsx`
- Modify: `src/features/chat/screens/ChatDetailScreen.tsx`
- Create: `app/(chat)/group-call.tsx`
- Create: `src/features/call/components/CallInviteHost.tsx`
- Create: `src/features/call/screens/GroupCallScreen.tsx`

- [x] **Step 1: Install LiveKit Expo dependencies**

Run: `npx expo install livekit-client @livekit/react-native @livekit/react-native-expo-plugin @livekit/react-native-webrtc @config-plugins/react-native-webrtc`

Expected: package and lockfile update. Actual: installed LiveKit packages with `npm install`; latest `@config-plugins/react-native-webrtc` required Expo 56, so installed `@config-plugins/react-native-webrtc@^14.0.0` for Expo 55.

- [x] **Step 2: Add Expo config plugins and permissions**

Update `app.json` with LiveKit/WebRTC plugins and microphone/camera permission text covering calls.

- [x] **Step 3: Add group call route**

Create route backed by `useCallStore` LiveKit credentials; render minimal audio call UI with participant list, mute, and leave button.

- [x] **Step 4: Replace group chat video-call placeholder**

For `conversationType=group`, call `createGroupCall()` with all current group members except self. Single-chat call remains disabled from this button.

- [x] **Step 5: Verify targeted frontend checks**

Run:
- `node --test src/features/call/store/use-call-store.test.mts`
- `npx tsc --noEmit`
- `npm run lint`

Expected: store tests pass; TypeScript should pass; lint may still report the known pre-existing Discover hook errors unless they are fixed separately.

Actual:
- `node --test src/features/call/store/use-call-store.test.mts`: PASS (5 tests; Node emits the existing ESM reparsing warning for `.mts` loading TS).
- `npx tsc --noEmit`: PASS.
- `npm run lint`: FAIL only on the known pre-existing `react-hooks/rules-of-hooks` errors in `src/features/discover/screens/CreateCircleScreen.tsx:97` and `src/features/discover/screens/InvitationVerificationScreen.tsx:192`; warnings remain elsewhere.
- `git diff --check`: PASS.

---

## Task 8: Final Verification and Commits

**Files:**
- All backend and frontend files above.

- [x] **Step 1: Backend final verification**

Run in backend worktree:
- `npm test -- --runInBand`
- `npm run build`
- `git diff --check`

Expected: PASS.

- [x] **Step 2: Frontend final verification**

Run in frontend worktree:
- `node --test src/features/call/store/use-call-store.test.mts`
- `npx tsc --noEmit`
- `npm run lint`
- `git diff --check`

Expected: store tests and typecheck pass. Document existing lint failures if still present.

- [x] **Step 3: Commit backend**

```bash
git add package.json package-lock.json prisma src
git commit -m "feat: add LiveKit group call backend"
```

- [ ] **Step 4: Commit frontend**

```bash
git add package.json package-lock.json app.json app src
git commit -m "feat: add LiveKit group call client"
```
