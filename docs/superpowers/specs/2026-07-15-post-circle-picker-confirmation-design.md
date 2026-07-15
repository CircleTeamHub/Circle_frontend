# Post Circle Picker Confirmation Design

## Goal

Keep circle-selection edits private to the picker until the user taps the confirmation button. Leaving with the header, gesture, or system back must preserve the post form's previously committed circles.

## Design

`SelectCircleScreen` keeps a component-local `draftCircles` array. On every screen focus, it resets that draft from `usePostFormStore.selectedCircles`, so a draft abandoned through any back path cannot survive a retained Expo Router screen. Row presses toggle only the local array. Checkmarks, selected count, and confirmation-button state all derive from the same draft. The confirmation button writes the complete draft through `setSelectedCircles` and then navigates back. Ordinary back navigation performs no store write.

This follows the existing `SelectFilterCirclesScreen` commit-on-confirm pattern. A store-level draft API would expand shared state unnecessarily, while rollback-on-back would be brittle because React Native exposes multiple exit paths.

## Testing

Add focused React Native Testing Library coverage for the screen. It verifies that toggling updates the draft UI without changing the committed store, ordinary back preserves committed selection, refocus resets an abandoned draft, and confirmation writes the fresh draft before navigating back. Then run the focused test and the repository's full CI script.
