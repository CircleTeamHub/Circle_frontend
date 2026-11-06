# Collection list and send confirmation implementation plan

**Goal:** Match the supplied compact collection cards in both collection screens and add an explicit recipient/content/message confirmation before sending.

**Architecture:** Share the list item and search/type toolbar between the existing native screens. Keep original-type forwarding in the existing chat send pipeline; the picker queues a favorite only after confirmation, carrying optional text/emoji as a following text message.

**Constraints:** Existing Expo/React Native app and themes; no new dependencies, backend changes, commits, real test messages, or generated content. Preserve existing collection previews, source navigation, batch operations, unsupported-source restrictions, and chat draft text. User confirmed text and emoji only for the additional message.

- [x] Add failing behavior checks: selecting a favorite requires confirmation, cancel sends nothing, confirm carries additional text; original media sends before its additional message and a rejected primary send does not send the extra text.
- [x] Add `CollectionListItem` and `CollectionListToolbar`; use them in `CollectionsScreen` and favorite mode of `SharePickerScreen`. Compact thumbnail, plain source at bottom left, short date at bottom right, no quote/return icon or disclosure arrow.
- [x] Add `FavoriteSendSheet` using `BottomSheetModal`, existing image previews, recipient avatar, text input, existing emoji picker, cancel/send. Pass only the destination conversation ID in navigation and derive recipient from the current chat store.
- [x] Extend the pending favorite with optional message; update `useComposerSend` and `useAttachmentActions` so the original favorite is queued first and the optional text follows, preserving queued/delivered error handling.
- [x] Add translations in the five existing locales. Run focused behavior/Node tests, typecheck, lint, and diff checks.
- [x] Build/install on the connected test phone, verify list parity, cancel, text/emoji editing and preview without sending a real message. Compare native screenshots with the supplied references and append the collection QA to `design-qa.md`. Verify owned tools have exited; keep the requested phone app available.
