# Persistent page snapshots implementation plan

**Goal:** Reopening the mobile app displays the last successful same-account page data immediately, then reconciles in the background. Existing image disk caches and encrypted chat SQLite remain in use.

**Architecture:** Reuse the app's initialized encrypted MMKV for bounded account-owned presentation snapshots. Hydrate synchronously in page/store initializers behind the existing storage startup gate. Cache presence governs initial loading; cache age governs background refresh only. Server authorization and financial mutations remain authoritative. No new packages or SQLite schema.

**Constraints:** Preserve the dirty workspace. Use `.codex-preview/persistent-cache-20261105/before/src` for task-only diffs. User will test: no device/UI/behavior tests or new test code; use static compiler/lint/review and delivery build/install. Do not store tokens, passwords, QR credentials or ephemeral message bodies. Drop private profile contact fields from persistent profile projections; native encrypted cache only, no new browser plaintext persistence. Explicit logout and cache clear remove owned snapshots.

## Shared storage interface (root)

`src/storage/page-snapshots.ts` exports:

```ts
type PageSnapshot<T> = { value: T; at: number };
readPageSnapshot<T>(userId: string | null | undefined, key: string): PageSnapshot<T> | null;
writePageSnapshot<T>(userId: string | null | undefined, key: string, value: T, at?: number): void;
removePageSnapshot(userId: string | null | undefined, key: string): void;
clearPageSnapshots(userId?: string, keyPrefix?: string): void;
getPageSnapshotRevision(): number;
```

Keys identify a domain and route (`notes:ACTIVE`, `profile:UUID`, etc.). The helper stores a versioned envelope and a bounded key index for eviction/cleanup, catches cache-only storage failures, and does not log values or account identifiers. Reads/writes are native-only and require initialized encrypted storage. The helper does not call APIs or grant permissions. Callers capture/check auth identity before async commits. A restored value never counts as current-session membership validation.

## Work items

- [x] Root: implement bounded snapshots; hook explicit session cleanup and clear-cache; trace chat SQLite/bootstrap first paint and temporary-chat list hydration. Keep shared services and unrelated processes.
- [x] Content: add persistent initial snapshots to note lists/groups/detail/collected state, collections, and known remote draft summaries; invalidate snapshots on successful note/collection writes. Cache filtered/full lists coherently. Preserve source authorization and pending-draft rules.
- [x] Social/groups/discover: persist safe profile/avatar/cover/settings projections, group presentation members/details (never validatedAccess), circle details/lists and personal moments. Hydrate before first render; retain background checks and clear denied entries. Persist friend/tag/search list sources where applicable.
- [x] Settings: hydrate confirmed privacy/auto-reply settings, wallet presentation balance/history, announcements and owned icons before loading. Keep wallet/account guards, fresh API reads and edit/transaction validation.
- [x] Integration: review all consumers, failure/empty/account-switch/logout/cache-clear behavior; run TypeScript and changed-file ESLint, obtain independent code review. Record limitations accurately.
- [x] Delivery: build and install once stable, retain data and do not open App pages. Verify owned temporary tool/build processes exited.
