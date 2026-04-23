# Chat UI Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat detail screen visually align with the supplied chat mock while preserving the app's existing theme tokens and current OpenIM behavior.

**Architecture:** Keep the existing chat screen and bubble components, but split the work into screen-level layout updates and bubble-level visual refinements. Use source-level tests to pin down the intended structure before changing implementation so the UI polish stays scoped and verifiable.

**Tech Stack:** Expo Router, React Native, TypeScript, existing theme tokens, Node `node:test`.

---

## File Structure

- Modify: `/Users/yiboding/projects/circle-im/src/features/chat/screens/ChatDetailScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/chat/components/chat-bubble.tsx`
- Create: `/Users/yiboding/projects/circle-im/test/chat-detail-screen.test.js`
- Create: `/Users/yiboding/projects/circle-im/test/chat-bubble.test.js`

### Task 1: Screen Layout Assertions

**Files:**
- Create: `/Users/yiboding/projects/circle-im/test/chat-detail-screen.test.js`
- Modify: `/Users/yiboding/projects/circle-im/src/features/chat/screens/ChatDetailScreen.tsx`

- [ ] **Step 1: Write the failing screen-structure assertions**
- [ ] **Step 2: Run `node --test test/chat-detail-screen.test.js` and confirm it fails**
- [ ] **Step 3: Implement the minimal screen layout refactor**
- [ ] **Step 4: Run `node --test test/chat-detail-screen.test.js` and confirm it passes**

### Task 2: Bubble And Card Assertions

**Files:**
- Create: `/Users/yiboding/projects/circle-im/test/chat-bubble.test.js`
- Modify: `/Users/yiboding/projects/circle-im/src/features/chat/components/chat-bubble.tsx`

- [ ] **Step 1: Write the failing bubble assertions**
- [ ] **Step 2: Run `node --test test/chat-bubble.test.js` and confirm it fails**
- [ ] **Step 3: Implement the minimal visual refinements**
- [ ] **Step 4: Run `node --test test/chat-bubble.test.js` and confirm it passes**

### Task 3: Focused Verification

**Files:**
- Create: `/Users/yiboding/projects/circle-im/test/chat-detail-screen.test.js`
- Create: `/Users/yiboding/projects/circle-im/test/chat-bubble.test.js`

- [ ] **Step 1: Run `node --test test/chat-detail-screen.test.js test/chat-bubble.test.js`**
- [ ] **Step 2: Inspect the final diff**
