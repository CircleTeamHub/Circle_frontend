# Profile City Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a city selector to the profile settings flow so users can choose and save their city from a predefined list.

**Architecture:** Extend the existing config-driven profile field system with a new `city` field and a dedicated picker mode in the shared edit screen. Keep the saved value as a plain city string, and wire it through API normalization so settings and profile views read the backend value consistently.

**Tech Stack:** Expo Router, React Native, Zustand, TypeScript, Node test runner

---

### Task 1: Lock behavior with tests

**Files:**
- Modify: `test/profile-edit-config.test.js`
- Modify: `test/api-utils.test.js`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run targeted tests to verify they fail**
- [ ] **Step 3: Assert `city` config, formatting, validation, payload mapping, and API normalization behavior**
- [ ] **Step 4: Re-run targeted tests and confirm they pass after implementation**

### Task 2: Wire city through profile data

**Files:**
- Modify: `src/services/api/auth.ts`
- Modify: `src/services/api/profile.ts`
- Modify: `src/services/api/utils.ts`
- Modify: `src/features/profile/profile-edit-config.ts`
- Modify: `src/features/profile/screens/SettingsScreen.tsx`

- [ ] **Step 1: Add `city` to backend user and update payload typings**
- [ ] **Step 2: Add `city` field config and settings row entry**
- [ ] **Step 3: Preserve backend `city` in normalized auth user**
- [ ] **Step 4: Re-run targeted tests**

### Task 3: Build the city picker UI

**Files:**
- Modify: `src/features/profile/screens/EditProfileFieldScreen.tsx`

- [ ] **Step 1: Add a predefined region-to-city dataset**
- [ ] **Step 2: Render city picker UI in the shared edit screen**
- [ ] **Step 3: Save the selected city through the existing profile PATCH flow**
- [ ] **Step 4: Run targeted tests and TypeScript verification**
