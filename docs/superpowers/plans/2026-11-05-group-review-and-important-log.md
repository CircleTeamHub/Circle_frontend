# Group Review and Important Log Implementation Plan

> For agentic workers: execute task-by-task in this session with the executing-plans workflow. Keep the existing mobile branch and preserve all unrelated dirty files. Backend work is isolated at `.codex-worktrees/group-notice-backend-release`, branch `codex/group-review-and-important-log-20261105`, based on main `6235216d92ef13d2708604443e3a4ed159a9e626`.

**Goal:** Put applicant review and important group logs inside group management, match the two supplied list/card references, and enforce the user-confirmed group blacklist on applications and invitations.

**Architecture:** Reuse standalone `GroupAdmissionService` and circle `CircleInvitationService` decisions. Add a manager-only paginated review API and bounded batch dispatcher without introducing a circular Nest module dependency. Persist join bans per conversation/user; enforce them at existing request creation and final admission boundaries. Use the existing group-event ledger for review/ban audit details and suppress routine profile metadata changes at both log write and read boundaries. Keep normal navigation in the current tab stack.

**Tech Stack:** Existing Expo/React Native, TypeScript, Zustand and i18n; NestJS, Prisma and PostgreSQL. No new package dependencies.

## Constraints

- User confirmed: blacklisted accounts cannot apply again or be invited back, including shared invitations/QR entry. Blacklisting an applicant must not silently remove an already joined member.
- Approve only consented pending applications; INVITED records awaiting the applicant's consent are not selectable for approval. Finished records remain visible as history.
- Manager authorization is checked on the server. Ordinary members cannot access applicant identities or administrative logs through direct routes.
- Search names/account IDs on the server across pagination; no loading every page to search locally.
- Batch actions handle partial success and retain failures for review; no automatic retry of writes and no direct real approvals/rejections/messages during QA.
- Log cards show only known date/status/source/inviter/operator fields. Do not invent historical source or operator values.
- No avatar, group-name or announcement-text edits in the group log; existing chat-message behavior remains scoped separately.
- Use actual product avatars and design components, not generated copies of real people or a standalone prototype. Preserve light/dark theme, safe areas and the Samsung taskbar fix.

## Tasks

- [x] Backend tests first: rejected/blocked request creation and final joins, standalone/circle manager authorization, cross-group request IDs, mixed batch outcomes, new important-log filtering/search. Run focused Jest tests and observe expected failures.
- [x] Add additive `ChatGroupJoinBan` migration/schema and a shared `assertGroupJoinAllowed(tx, where)` check. Apply it to standalone creation/acceptance and circle application/invitation/final activation. Add transactional reject-and-ban actions and review event payloads using existing write/notification paths.
- [x] Add manager review controller/service (registered in CircleInvitationModule, which already imports ChatModule): GET `/chat/groups/:id/reviews` with cursor/keyword, POST `/chat/groups/:id/reviews/actions` with 1–50 unique IDs and approve/reject/blacklist. Map standalone/circle requests to applicant/inviter/status/source and return per-item outcomes.
- [x] Extend group event reads with manager authorization, important-kind filtering and target/operator search; retain cursor progress and alias/avatar resolution. Add review metadata to the response without fabricating missing old values.
- [x] Mobile tests first: shared-scope review/log entry visibility, selection eligibility/search/batch actions and failed-item retention, important log card fields/search role/pagination. Add five route exports for the new group review screen and move the group-log entry out of ChatInfo into GroupManage. Add the review screen's log shortcut.
- [x] Implement the two supplied layouts with existing avatars/name components, rounded search controls, a selectable review list, safe-area batch footer, and key/value log cards. Add five-locale copy and keep the existing notification/invitation detail routes working.
- [x] Verify focused behavior/Node tests, frontend/backend TypeScript and scoped lint. Review the scoped backend diff, prepare a ready PR and the concrete additive migration for the already established test release flow. Build and verify the APK sources/asset hash.
- [x] Deploy authorized test changes through normal CI/release gates, install with login/data preserved, capture and compare native QA states against the supplied references, append results to `design-qa.md`, and clean up owned temporary processes. Do not perform real group decisions or send announcements for QA.

Deployment completed through Release42139792523 as6ca9fc7162cd5b92c464d15134cea6448fdf1b73. Final application-list visual QA was stopped at the user’s explicit request; logs/return/safe-area captures were already verified. Login keyboard obstruction was added as a follow-up code/build fix; user will test it personally.

Final APK including the login keyboard follow-up was built and installed with data retained. User waived further testing; no remaining authorized testing was performed. Owned temporary processes exited.
