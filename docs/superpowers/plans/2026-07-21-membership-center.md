# Four-tier Membership Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the points-based VIP1-VIP5 exchange screen with a four-tier, customer-service-assisted membership center.

**Architecture:** Add a pure profile-domain membership catalog as the UI source of truth, render it from the existing Expo Router screen, and keep actual quota enforcement on the backend. The screen must not call the legacy plan or upgrade endpoints; an optional public support-account id enables an in-app profile route, with an explanatory alert as fallback.

**Tech Stack:** Expo Router, React Native, TypeScript, i18next, Node test runner

---

### Task 1: Membership catalog

**Files:**
- Create: `src/features/profile/membership-plans.ts`
- Create: `src/features/profile/membership-plans.test.mts`

- [ ] Write failing tests for the four exact prices/durations, every value in all nine benefit rows, absence of voice-to-text/avatar-frame/animated-avatar benefits, and legacy level mapping.
- [ ] Run `node --test src/features/profile/membership-plans.test.mts` and confirm it fails because the module is missing.
- [ ] Implement the minimal typed catalog and `getMembershipTierForVipLevel` helper.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Membership center UI and contact flow

**Files:**
- Modify: `test/profile-commerce-pages.test.js`
- Modify: `src/features/profile/screens/MemberCenterScreen.tsx`
- Modify: `src/features/profile/screens/ProfileScreen.tsx`
- Modify: `.env.example`

- [ ] Replace the old static source test with assertions for four tiers, no legacy API imports, horizontal tier scrolling, the diamond recommendation marker, the super lifetime marker, the benefits section, customer-service CTA, support-account routing/fallback, and activation-versus-upgrade labels.
- [ ] Run `node --test test/profile-commerce-pages.test.js` and confirm the new assertions fail against the old screen.
- [ ] Rebuild the screen with horizontal plan selection, current-tier display, diamond recommendation marker, super lifetime emphasis, benefits, upgrade copy, and optional `EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID` routing with an alert fallback.
- [ ] Reuse `getMembershipTierForVipLevel` in `ProfileScreen.tsx` so level 0 displays as a regular user and every level 4 or higher displays as super member.
- [ ] Re-run the focused test and the catalog test.

### Task 3: Rules and localization

**Files:**
- Modify: `src/features/profile/screens/MemberRulesScreen.tsx`
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ja.json`
- Modify: `src/i18n/locales/ko.json`
- Modify: `src/i18n/locales/es.json`
- Modify: `test/profile-commerce-pages.test.js`

- [ ] Add failing assertions that every locale contains the new membership and rule keys and that obsolete exchange copy is absent from the screen.
- [ ] Run the focused test and confirm the assertions fail.
- [ ] Add localized membership catalog, benefit, contact, upgrade, and rule copy; update the rules screen to render the new rule set.
- [ ] Re-run focused tests and locale parity tests.

### Task 4: Verification

**Files:**
- Modify only files required by failures caused by this feature.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run test:behavior` if the preceding checks pass.
- [ ] Start the Expo web app and visually check a small mobile viewport for horizontal scrolling, selected benefits, CTA placement, and text overflow when the environment can render the app.
- [ ] Inspect `git diff --check` and the final diff for legacy in-app exchange behavior or accidental unrelated changes.
