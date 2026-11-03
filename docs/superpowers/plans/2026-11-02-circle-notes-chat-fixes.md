# Circle, notes and chat fixes implementation plan

> Execute independent tasks with subagent-driven-development, then review the combined diff and run focused and shared checks.

Goal: Correct invitation sponsorship, refresh shared note statuses, improve note editing, chat media and keyboard behavior.

Architecture: Reuse existing admission transactions, source-status signals, image viewer, native video fullscreen and keyboard animation APIs. Preserve unrelated pending changes and add no dependencies unless an existing platform API cannot implement the requested behavior.

## Tasks

- [x] Circle invitation: trace backend `circle`/invitation admission; reproduce inviter missing from validators, count actual inviter once and exclude from candidate list. Add transaction/behavior regression checks.
- [x] Note card status: trace `use-note-card-status-sync`, note status signals and backend realtime payloads; test changes while chat remains mounted and on recovery, patch original cards without resending.
- [x] Note editor: `EditNoteScreen` media display changes from tiles to full width images with viewer; toolbar exposes image and video separately, removes recording entry, preserves existing stored audio. Update focused editor tests.
- [x] Chat media: `video-bubble` opens native fullscreen on tap; image renderer opens shared viewer with ordered conversation images. Preserve long presses, expired/ephemeral media behavior and cleanup. Add behavior checks.
- [x] Keyboard: trace composer panel/input and keyboard avoiding hooks; dismiss on message/background tap without intercepting child actions, avoid emoji keyboard oscillation, animate keyboard/panel transitions with native events. Add behavior checks.
- [x] Post stripe proposal: inspect existing counts and capacity; propose participation progress color plus text/count, keep reputation separately visible. Do not silently change meaning before a concrete design is established.
- [x] Verify: focused tests per task, frontend typecheck and lint, backend targeted checks, review diff, stop all started temporary processes.


Validation: 3,457 frontend node tests and 960 frontend behavior tests passed, with no skipped tests. Backend: 721 focused tests passed. Frontend typecheck/lint and backend production typecheck passed; scoped backend lint has no errors and existing warnings. Final review found and fixed gallery read receipts so viewing received images also starts burn timers. The Windows preproduction fixture uses asynchronous cleanup to avoid Node rmSync EPERM errors. Native playback/gestures/keyboard animation still require device checks. PostgreSQL integration tests were not run because no confirmed isolated database was available. The stripe recommendation is signup heat: 0 neutral, 1-4 blue, 5-9 purple, 10+ orange; existing stripe code is unchanged pending the product decision.
