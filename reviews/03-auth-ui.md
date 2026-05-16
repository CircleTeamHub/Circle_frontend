# Review Batch 03 — Auth UI (6 files, 487 lines)

> Files: `src/features/auth/index.ts` · `LoginScreen.tsx` · `RegisterScreen.tsx` · `app/(auth)/_layout.tsx` · `login.tsx` · `register.tsx`
> Plus one cross-surface fix: `src/components/ui/auth-input.tsx` (touched because it's the shared TextInput wrapper used by 9 auth-related screens; patches here unblock every auth field).
> Date: 2026-05-14
> Surface: Auth & token lifecycle (UI layer — closes the auth surface at 14/14)
> **Status: Patched. 7 MEDIUM + 5 LOW resolved across 4 files + 1 cross-surface primitive. 2 product/design decisions deferred (#12 #13).**

---

## Patches applied

`git diff --stat`:
```
 app/(auth)/_layout.tsx                       |  2 +-     comment typo
 src/components/ui/auth-input.tsx             | 23 ++++++ autoCorrect/spellCheck=false + textContentType + autoComplete props
 src/features/auth/screens/LoginScreen.tsx    |  4 ++     textContentType="username|password" + autoComplete
 src/features/auth/screens/RegisterScreen.tsx | 29 +++-   autofill props + agreement gating + router.replace + stale memo dep
 src/hooks/use-auth.ts                        | 96 +++--  in-flight ref guard (Pattern D second guard)
 5 files changed, 117 insertions(+), 37 deletions(-)
```

`tsc --noEmit`: clean.
`test/auth-api.test.js`: 7/7 pass (unchanged regression check).
`test/auth-session.test.js`: 5/5 pass (unchanged regression check).

### ✅ Fixed

- **`src/components/ui/auth-input.tsx`** — Hardcoded `autoCorrect={false}` `spellCheck={false}` for **every** call site (9 fields across 4 screens). Closes the silent autocorrect-mangling regression where iOS could "correct" `"alice123"` mid-stream. Plus new optional `textContentType` + `autoComplete` props for OS-level password-manager integration.
- **`LoginScreen.tsx`** — Account input: `textContentType="username"` / `autoComplete="username"`. Password input: `textContentType="password"` / `autoComplete="current-password"`. iOS Password AutoFill, Android Smart Lock, and 1Password / Bitwarden / Apple-Keychain all surface saved credentials now.
- **`RegisterScreen.tsx`** — Same autofill hints on all 4 fields (using `username-new` / `new-password` / `nickname` semantics so password managers offer "save new password" instead of "fill saved password").
- **`RegisterScreen.tsx`** — Register button now requires `agreed === true` (visible disabled state + `onPress` early-return + `disabled={submitting || !agreed}`). Closes the **compliance issue** where users could register without checking the ToS checkbox. The button is now visually disabled until the box is checked.
- **`RegisterScreen.tsx`** — "Already have account → Login" uses `router.replace('/(auth)/login')` instead of `router.back()`. Survives deep-link / push-notification entries where there's no prior route to pop back to.
- **`RegisterScreen.tsx`** — Dropped stale `insets.bottom` dep from the `useMemo` (the memo body doesn't read it; keyboard show/hide on Android was invalidating styles for no reason).
- **`use-auth.ts`** — Added `inFlightRef` re-entrancy guard at the top of `login` / `register` / `endSession`. **Pattern D's second guard:** the screen's `disabled={submitting}` is one frame late on a fast double-tap; the ref enforces single-flight at the hook level. Released in `finally`.
- **`app/(auth)/_layout.tsx`** — Fixed `//个项目` typo to `// 这个项目` (was a missing leading character).

### ✅ Resolved 2026-05-14 — decisions #12 #13

| # | Action taken |
|---|---|
| 12 | **Fixed (option C).** Forgot-password text is now wrapped in a `Pressable` with `Alert.alert(t('auth.forgotPassword'), t('auth.forgotPasswordHint', { defaultValue: '该功能即将上线。如需要找回账号，请联系客服。' }))`. When the real route lands, swap the body for `router.push('/(auth)/forgot-password')`. |
| 13 | **Deleted entirely.** Both `LoginScreen.tsx` and `RegisterScreen.tsx` no longer render social-login. Removed: `<View style={s.dividerRow}>…</View>` + `<View style={s.socialRow}>…</View>` JSX, the `dividerRow` / `dividerLine` / `dividerText` / `socialRow` / `socialBtn` style entries, the matching dynamic style entries in the `useMemo`, and (in LoginScreen) the now-unused `Ionicons` import. RegisterScreen keeps Ionicons (used by the agreement checkmark). |

### Final diff for decisions #12 #13 only:
```
 src/features/auth/screens/LoginScreen.tsx    | +21/-30
 src/features/auth/screens/RegisterScreen.tsx | +0/-45
```
tsc clean. 12/12 tests still pass. No orphan references to removed styles or icons.

---

## Batch summary

The two screens are clean Expo / RN structure — `StyleSheet.create`, theme tokens, `useMemo` for dynamic styles, `safe-area-context`, `keyboardShouldPersistTaps="handled"`. The login/register **flow correctness** comes from `useAuth` (Batches 01-02), so the surface area for bugs here is **input affordances**, **form-gating**, and a couple of **broken-but-rendered controls**:

1. **Forgot-password and social-login Pressables are dead** — rendered, look interactive, but `onPress` is missing entirely. Users tap → nothing happens.
2. **Register's terms-agreement checkbox is decorative** — the `agreed` boolean is stored but never gates the Register button.
3. **Auth-input affordances are below mobile-app norm** — no autofill hints (`textContentType` / `autoComplete`), no `autoCorrect={false}`, no `spellCheck={false}`, no keyboard return-key chaining. iOS / Android password managers can't surface saved credentials.
4. **No hook-level double-submit guard** — the button has `disabled={submitting}`, but on a fast double-tap RN's Pressable can fire `onPress` twice before React renders the disabled state. Pattern D from the skill calls for both UI **and** hook-level guards.

No HIGH findings — the auth flow itself was correct.

---

# File 1 — `src/features/auth/index.ts` (2 lines)

Barrel: `export { default as LoginScreen } from './screens/LoginScreen';` etc. Nothing to review. ✅

---

# File 2 — `src/features/auth/screens/LoginScreen.tsx` (192 lines)

## Findings

### `L146-148` [MEDIUM · BUG] — Forgot-password link is dead text, not a Pressable
```tsx
<View style={s.forgotRow}>
  <Text style={[s.forgotLink, d.forgotLink]}>{t('auth.forgotPassword')}</Text>
</View>
```
Rendered as a styled link (primary color, right-aligned), visually identical to a tap target — but there's no `Pressable`, no `Link`, no `onPress`. Tapping it does nothing. Users will think the app is broken.

**Fix options:**
- A. **Implement** the forgot-password route + screen. Real fix but needs backend.
- B. **Hide it** until the route exists. Smallest change today.
- C. **Show an Alert** ("即将上线") on tap. Honest stopgap; user knows it's coming.

Deferred — product decision.

---

### `L175-179` [MEDIUM · BUG] — Social login button has no `onPress`
```tsx
<Pressable style={[s.socialBtn, d.socialBtn]}>
  <Ionicons name="chatbubble-ellipses" size={24} color="#07C160" />
</Pressable>
```
WeChat icon in a tappable shape. Same problem as the forgot-password link. Same fix options.

Deferred — product decision (WeChat OAuth requires app registration + native SDK or expo-auth-session config).

---

### `L135-139, L140-145` [MEDIUM · UX/SECURITY] — Inputs lack autofill / password-manager hints
```tsx
<AuthInput placeholder={t('auth.accountPlaceholder')} value={account} onChangeText={setAccount} />
<AuthInput placeholder={t('auth.passwordPlaceholder')} value={password} onChangeText={setPassword} secureTextEntry />
```
On iOS, without `textContentType="username"` / `"password"`, the OS keyboard's QuickType bar won't suggest saved credentials and Password AutoFill won't trigger. On Android, without `autoComplete="username"` / `"password"`, the same applies. Saved-credential users have to type from scratch.

**Fix:** extend `AuthInput`'s props to forward `textContentType`, `autoComplete`, and use them here.

---

### `L155-165` [MEDIUM · SAFETY] — No hook-level double-submit guard (only button-level)
```tsx
<Pressable
  style={[s.loginBtn, d.loginBtn, submitting && s.btnDisabled]}
  onPress={() => login(account, password)}
  disabled={submitting}
>
```
`disabled={submitting}` is correct but not sufficient. On a fast double-tap, two `onPress` callbacks can fire **before** React renders the `disabled` state from the first `setSubmitting(true)`. Two simultaneous `loginRequest` calls → two `setSession` writes → potentially inconsistent.

**Fix in `useAuth`**: add a `useRef(false)` re-entrancy gate at the top of `login` / `register` / `endSession`. Belt-and-suspenders matching Pattern D from the skill (both guards required).

---

### `L146-148` [LOW · UX] — No keyboard return-key chaining
After typing the password, pressing the keyboard's return key does nothing. Modern iOS pattern: account → "Next" → focus password → "Go" → submit. Needs `returnKeyType`, `onSubmitEditing`, and a `ref` chain on `AuthInput`. Out of scope unless we expand `AuthInput`'s API significantly.

---

### `L83-89` [LOW · PERF] — `() => login(account, password)` allocates per render
Inline arrow in `onPress`. Cost is negligible (one Pressable, one click) but the pattern matters at scale and breaks `React.memo` if `Pressable` ever gets memoized. `useCallback` is the idiomatic fix.

---

### `L88-89` [LOW · UX] — Inputs remain editable while `submitting`
A user can change the account during the 2-second login round-trip. The submitted credentials are captured at button-press time, so this is safe, but visually misleading (form looks live). Disabling inputs during `submitting` is the norm.

---

### `L91-109` [LOW · CLARITY] — `d` (dynamic styles) accumulates 14 keys
Splitting into `colors`-derived styles is fine, but the bag is getting large. Once `_layout.tsx` settles, consider exporting a `useAuthScreenStyles()` hook to deduplicate across login/register.

---

### `L121-125` [LOW · CLARITY] — Logo composed of 4 overlapping positioned Views
Works; would be cleaner as an SVG or a single component. Cosmetic, won't move on this pass.

## Test gaps for LoginScreen.tsx
- No test renders the screen and asserts that `disabled` and `submitting` propagate correctly
- No test covers tapping a dead-link control (would force a decision on what dead controls should do)

---

# File 3 — `src/features/auth/screens/RegisterScreen.tsx` (268 lines)

## Findings

### `L214-240` [MEDIUM · BUG · COMPLIANCE] — Terms-agreement checkbox is decorative
```tsx
const [agreed, setAgreed] = useState(false);
// ...
<Pressable style={s.agreementRow} onPress={() => setAgreed(!agreed)}>
  {/* visual checkbox */}
  <Text>{t('auth.agreement')}</Text>
</Pressable>
// ...
<Pressable
  style={[s.registerBtn, d.registerBtn, submitting && s.btnDisabled]}
  onPress={() => register(account, password, nickname, confirmPassword)}  // ← no agreed check
  disabled={submitting}                                                    // ← only disabled by submitting
>
```
The checkbox toggles `agreed` but **nothing reads `agreed`** — register fires regardless. This is a real compliance issue if the agreement covers ToS / privacy. Users who never check the box can still register.

**Fix:**
```tsx
<Pressable
  style={[s.registerBtn, d.registerBtn, (submitting || !agreed) && s.btnDisabled]}
  onPress={() => {
    if (!agreed) return;
    register(account, password, nickname, confirmPassword);
  }}
  disabled={submitting || !agreed}
>
```
Patch now — straightforward and doesn't change any contract.

---

### `L249-254` [MEDIUM · BUG] — Same dead social-login button as LoginScreen
Same fix options. Deferred.

---

### `L184-212` [MEDIUM · UX/SECURITY] — Same missing autofill / autoCorrect hints
Apply via `AuthInput` extension (see auth-input.tsx fix below).

---

### `L230-240` [MEDIUM · SAFETY] — Same missing hook-level double-submit guard
Covered by the `useAuth` ref-guard patch.

---

### `L260-263` [LOW · BUG] — "Already have account → Login" uses `router.back()`
```tsx
<Pressable onPress={() => router.back()}>
  <Text>{t('auth.loginNow')}</Text>
</Pressable>
```
Brittle for deep-link / push-notification entries: if the user landed directly on `/(auth)/register` without first visiting login, `router.back()` either pops nothing or pops out of the auth group. Use `router.replace('/(auth)/login')`.

---

### `L116-165` [LOW · CORRECTNESS] — Stale `useMemo` dep `insets.bottom`
```tsx
const d = useMemo(() => ({ ... }), [colors, insets.top, insets.bottom]);
```
The memo body doesn't read `insets.bottom`. Cheap memo invalidations when only `insets.bottom` changes (e.g. keyboard show/hide on Android). Drop the dep.

---

### `L165` [LOW · CLARITY] — `as const` cast on `fontWeight` inside `useMemo`
```tsx
fontWeight: '700' as const,
```
Works, but RN's `TextStyle` accepts `'700'` as `string`. The `as const` is unnecessary unless `d.heading` is passed somewhere strictly typed. Cosmetic.

---

### `L110-114` [LOW · POLICY] — No password-strength feedback
Hook enforces `length >= 6`. UI doesn't show why a password is rejected until after submit. A live indicator (✓ 6+ chars, ✓ matches confirm) is the modern norm but takes design work. Skip.

---

### `L226-228` [LOW · ARCHITECTURE] — Validation messages all come back through `error`
Same single `error` channel for "agreed checkbox not ticked" (after the fix above), "password too short", "passwords don't match", etc. Field-level error rendering near each input is better UX but a much bigger refactor.

## Test gaps for RegisterScreen.tsx
- No test asserts `agreed=false` blocks register submit (will be regression coverage for the fix)
- No test for `router.replace` vs `router.back` from the deep-link entry

---

# File 4 — `app/(auth)/_layout.tsx` (23 lines)

Single Stack with `headerShown: false`, theme-aware contentStyle, slide animation. Clean.

### `L11` [LOW · TYPO] — Comment starts with `//个项目` (missing leading "这")
```tsx
//个项目用的是自定义 NavHeader 组件，不用系统自带的导航栏。
```
Should be `// 这个项目用的是...`. Cosmetic.

---

# Files 5–6 — `app/(auth)/login.tsx` / `register.tsx` (1 line each)

```tsx
export { default } from '@/features/auth/screens/LoginScreen';
```
Pure route wrappers. Nothing to review. ✅

---

# Cross-surface fix — `src/components/ui/auth-input.tsx`

This is a UI primitive (formally Surface 11), but it's the shared TextInput wrapper used by **all 9 auth-input call sites across 4 screens** (LoginScreen × 2, RegisterScreen × 4, ChangeAccountScreen × 1, ChangePasswordScreen × 3). Patching here unblocks every auth field in one shot. Findings:

### `L90-99` [MEDIUM · UX/SECURITY] — Hardcoded `autoCapitalize="none"` is good; missing `autoCorrect={false}` / `spellCheck={false}` is not
```tsx
<TextInput
  ...
  autoCapitalize="none"
/>
```
`autoCapitalize="none"` is correct for all auth fields. But iOS autoCorrect is **enabled by default** — typing an unusual username may get autocorrected mid-stream. Same for `spellCheck`. Both should be off for auth fields.

### `L6-15` [MEDIUM · UX/SECURITY] — Props don't expose autofill hints
No `textContentType` (iOS) or `autoComplete` (cross-platform). Without these, Password AutoFill / strong-password suggestions / saved-credential autofill don't work. Saved-credential users have to type from scratch.

### `L11-13` [LOW · API] — `secureTextEntry?` already supports toggle (eye icon, good); but no `returnKeyType` / `onSubmitEditing` for keyboard chaining
Adding these requires ref forwarding — bigger change. Skip for now; revisit if we do focus management.

## Patch plan
- **Always** pass `autoCorrect={false}` and `spellCheck={false}`.
- **Accept** optional `textContentType` and `autoComplete` props, forward them.
- Don't change defaults that callers rely on (`autoCapitalize="none"` stays hardcoded — it's correct for every existing call site).

---

# Patches proposed (this batch)

Defensible without further input:

1. **`src/components/ui/auth-input.tsx`** — always `autoCorrect={false}` `spellCheck={false}`; accept optional `textContentType` and `autoComplete` props.
2. **`src/features/auth/screens/LoginScreen.tsx`** — pass `textContentType` / `autoComplete` to the two inputs.
3. **`src/features/auth/screens/RegisterScreen.tsx`** — pass `textContentType` / `autoComplete` to all four inputs; gate Register button with `!agreed`; switch `router.back()` to `router.replace('/(auth)/login')`; drop stale `insets.bottom` memo dep.
4. **`src/hooks/use-auth.ts`** — add a `useRef(false)` re-entrancy guard at the top of `login` / `register` / `endSession` (Pattern D's second guard).
5. **`app/(auth)/_layout.tsx`** — fix the `//个项目` typo.

## Deferred — needs product / design decision

| # | Where | Issue | Options |
|---|---|---|---|
| 12 | `LoginScreen:146-148` | Forgot-password Pressable is dead text | A. Implement route + backend. B. Hide. C. Alert "即将上线". |
| 13 | `LoginScreen:175-179`, `RegisterScreen:249-254` | Social-login (WeChat) Pressables have no `onPress` | A. Wire WeChat OAuth via expo-auth-session. B. Hide. C. Alert "即将上线". |
