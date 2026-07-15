# Post Circle Picker Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unconfirmed circle-picker edits from mutating the post composer.

**Architecture:** Keep selection changes local to `SelectCircleScreen` and commit the full array to `usePostFormStore` only from the confirmation action. Preserve the current minimum-one-circle rule and existing UI.

**Tech Stack:** React Native, Expo Router, Zustand, Node test runner

---

### Task 1: Make circle selection commit-on-confirm

**Files:**
- Create: `src/features/discover/screens/SelectCircleScreen.spec.tsx`
- Modify: `src/features/discover/screens/SelectCircleScreen.tsx`

- [ ] **Step 1: Write the failing test**

Add React Native Testing Library tests that render the picker with one committed circle. Verify that selecting another circle updates the displayed count without mutating the store, ordinary back preserves the committed array, simulated refocus resets the count, and confirmation commits the fresh draft before navigating back.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx jest src/features/discover/screens/SelectCircleScreen.spec.tsx --runInBand`

Expected: FAIL because the screen currently calls the store's `toggleCircle` eagerly and cannot reset an abandoned local draft on focus.

- [ ] **Step 3: Write the minimal implementation**

Import `useState` and `useFocusEffect`, reset `draftCircles` from committed `selectedCircles` on focus, replace the eager store toggle with a local state update, derive checkmarks/count/button state from `draftCircles`, and add `handleConfirm` that calls `setSelectedCircles(draftCircles)` followed by `router.back()`. Bind the confirmation button to `handleConfirm`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npx jest src/features/discover/screens/SelectCircleScreen.spec.tsx --runInBand`

Expected: PASS.

- [ ] **Step 5: Run full verification**

Run: `npm run ci`

Expected: typecheck, Expo config, lint, Node tests, and Jest behavior tests all exit successfully.
