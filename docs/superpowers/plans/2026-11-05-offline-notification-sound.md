# Offline Notification Sound Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Use Swift gesture for in-app and offline message/activity notifications.

**Architecture:** Bundle a single PCM WAV through expo-notifications, create Android channels before React Native starts, and name the same sound/channels in the existing Expo and JPush backend senders. Android channel migration copies existing sound choices and importance without deleting channels. Call ringing remains separate.

**Tech Stack:** Expo 55, TypeScript, Kotlin via an Expo config plugin, NestJS.

## Global Constraints

- No new application dependencies; preserve unrelated workspace changes.
- Sound: `notification_swift_gesture.wav`; Android channels: `chat_swift_gesture`, `activity_swift_gesture`.
- Preserve existing Android mute/custom sounds; replace only the system default sound.
- Native sound resources require a new APK/IPA; backend delivery changes require deployment.
- Native version floor is 1.0.2 (Android versionCode 1000002); older/unknown clients keep legacy channels and system sounds so JPush cannot create new channels prematurely.

### Task 1: Bundle the selected sound

- [x] Convert the selected MP3 to mono 48 kHz 16-bit PCM WAV, check duration and decoded samples, then remove the redundant MP3.
- [x] Update the in-app source, attribution, and expo-notifications sounds configuration for both iOS call modes.
- [x] Update and run `node --test test/notification-feedback-playback.test.js test/with-call-push.test.js`.

### Task 2: Configure Android delivery channels

- [x] Add `plugins/with-notification-sound.js` using `withMainApplication` and `mergeContents`; register the two channels after `super.onCreate()`.
- [x] Read the prior provider channel (`chat`/Expo fallback for Expo; `JPush_3_7` for JPush), preserve its importance and custom/null sound, and replace only `Settings.System.DEFAULT_NOTIFICATION_URI` with the bundled resource URI.
- [x] Update the JS chat channel ID and sound; add focused plugin/config contract coverage and run `node --test test/chat-notifications.test.js test/with-notification-sound.test.js`.

### Task 3: Coordinate backend payloads and verify

- [x] In `../circle_be_main`, set `CHAT_PUSH_CHANNEL_ID = 'chat_swift_gesture'`; send `notification_swift_gesture.wav` in Expo/iOS payloads and `notification_swift_gesture` plus the correct `channel_id` in JPush Android payloads.
- [x] Extend existing sender tests to assert default and explicit channels, iOS sound, and unchanged call notification sounds; observe the relevant assertions fail before implementation.
- [x] Run backend notification/chat Jest suites, TypeScript checks, frontend focused tests/lint/typecheck, and Android native prebuild/compile where available.
- [x] Remove temporary audio tools and verify every process started by this task has exited.

## Verification results

- Frontend: 91 focused tests passed; TypeScript and changed-file ESLint passed. The missing local Expo command shim was bypassed by invoking the installed Expo/TypeScript CLIs directly.
- Backend: 117 notification/outbox/chat tests passed; TypeScript checks passed. Existing unrelated lint warnings remain in the outbox files.
- Native: generated channel initialization compiled against Android SDK 35; the Expo Android resource copy matched the PCM WAV bytes.
- Temporary audio/compiler files were removed and recorded worker processes exited.
- APK/IPA release builds, deployment, and physical-device offline push delivery were not run.

## PR verification on latest main

- Frontend complete Node suite: 3,557 passed; notification/settings Jest behavior tests: 30 passed.
- Backend notification/outbox/chat suites: 117 passed; both repositories passed TypeScript checks.
- Changed frontend files passed ESLint; Expo and JPush generated Kotlin both compiled against Android SDK 35.
- Read-only review findings were fixed: provider-specific legacy channel migration and omission of channel_id for old/unknown JPush clients. Re-review found no remaining actionable issues.
- Frontend cross-repository tests used the matching backend branch. Windows shell tests used Git Bash on PATH.
