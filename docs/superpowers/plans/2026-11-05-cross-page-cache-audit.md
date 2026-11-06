# Cross-page cache audit and repair implementation plan

**Scope:** Current production Expo app on codex/fix-note-self-contact-20261103. Preserve the existing dirty tree. User requests finding and repairing sibling cache/data-loading defects identified in prior chat/profile/group fixes. The user will test personally: do not run device/UI or behavior tests. Static review, compiler/lint and a final delivery build remain available; no new packages or server changes are planned.

**Approach:** Follow existing account-scoped caches, Zustand snapshots, mutation timestamps and focus-reload gate. Do not remove first-load or authorization/transaction verification. Existing data must remain visible during same-identity refresh; different accounts/routes must not reuse previous private content. Do not persist new sensitive data.

**Baseline:** .codex-preview/cache-audit-20261105/before/src snapshots 1004 source files / 132 screens before this task. This is the comparison base, not HEAD (HEAD omits earlier requested changes).

## Work items

- [x] Content: preserve known remote draft rows during local merge; invalidate note contact-picker freshness via friendsMutatedSince using request-start timestamps; reconcile collected-copy state after note writes; scope note detail and retained note lists/pickers to account/route. Trace collections source use, preserve account-owned filter snapshots and add create/delete invalidation plus focus reload without hiding valid rows.
- [x] Social/groups/discover: use focus+mutation revalidation in invitation verifier, friend-tag detail and friend search; recognize both circle and group mutations for circle metadata/lists; distinguish complete conversation snapshots from one-off upserts in recipient pickers; reconcile the personal moments album after successful moment mutation. Preserve live permission checks and QR/verification validity reads.
- [x] Settings: keep auto-reply form state during same-account reload using existing privacy/setting source; consume realtime wallet balance without duplicate GET; preserve transaction rows on background errors; preserve same-version system announcement banner on transient refresh failure. Keep live wallet validation and authoritative security reads.
- [x] Shared media and remaining modules: inspect public/persistent image policies and artificial fades separately from ephemeral media; inspect temporary chat/list and common store focus paths for clear-before-refresh and duplicate requests. Reuse existing components/stores; add no generic cache framework.
- [x] Integrate: read each scoped diff and write invalidation path; inspect account changes, failures, route changes and freshness signals. Run static compiler/scoped lint only (no functional/device tests by user request). Record exact coverage, intentional current reads, findings/fixes and remaining limits.
- [x] Deliver: build once after changes stabilize, install updated test APK with data retained for user's own testing if the prior USB authorization remains usable. Do not open pages or perform group/message/wallet mutations. Clean up owned temporary processes and preserve shared app services.

## Review constraints

- No caching passwords/tokens, QR credentials or membership authority in presentation caches.
- Same-account stale data is presentation only; server mutations retain authoritative checks.
- Successful writes invalidate related cache families; failed writes must not mark cached data fresh.
- Auth epoch/user identity and route keys govern cached rows. A single loaded conversation must not imply a complete conversation list.
- A failed background request must not silently replace known rows with empty/partial data. Revocation/forbidden responses retain their existing fail-closed behavior.
