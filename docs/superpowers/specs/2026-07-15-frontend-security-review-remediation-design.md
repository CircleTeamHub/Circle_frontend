# Frontend Security Review Remediation Design

## Goal

Close the three frontend findings from the 2026-07-15 committed-code review:
remove the broken and unsafe recharge flow, preserve one idempotency key across
ambiguous gift retries, and purge sensitive profile fields from legacy MMKV
snapshots during hydration.

## Target

Implement on a branch based on
`origin/fix/client-security-remediation` (`f91f738`). Keep the existing IM and
call-lifecycle fixes unchanged.

## Recharge Decision

The app has a visible purchase UI and a `POST /coin/recharge` client call, but
`circle_be` has no user recharge route, payment order, provider callback, or
receipt verification contract. Adding an endpoint that accepts a client-supplied
coin amount would permit arbitrary balance creation.

The wallet becomes read-only for this remediation:

- retain balance loading and realtime balance updates;
- remove recharge packages, prices, confirmation dialogs, mutation state, and
  the nonexistent `rechargePoints` API function;
- show concise copy that purchasing is temporarily unavailable;
- leave admin top-up behavior in the backend unchanged.

A real purchase flow is a separate product and security project requiring
server-created orders, provider-signed callbacks, replay protection, and an
immutable mapping from paid product SKU to awarded coins.

## Gift Idempotency

`sendCoinGift` continues accepting an optional explicit idempotency key. The
transfer composer owns the key because it owns the user's transfer intent.

Define a small pure helper that stores:

- an intent signature derived from normalized recipient ID, integer amount,
  and trimmed message;
- the generated idempotency key for that signature.

On submission, reuse the stored key when the signature is unchanged. Generate
a new key when the recipient, amount, or message changes. Retain the key after
network errors and other ambiguous failures, because the server may already
have committed the transfer. Clear it only after confirmed success or when a
different intent is submitted.

The existing in-flight guard remains responsible for same-frame double taps;
the retained key handles sequential user retries after an error response.

## PII Migration

`sanitizeUserForPersist` remains the single definition of fields that must not
be stored in plaintext. Refine its type so it can sanitize both typed
`AuthUser` values and validated record-shaped legacy values.

Apply it at both persistence boundaries:

1. Zustand `partialize`, covering all new writes.
2. `secure-auth-storage` envelope sanitation, covering auth and known-account
   hydration, token migration, degraded-mode merges, and explicit writes.

When reading an existing MMKV envelope, sanitize `state.user` and every
`state.accounts[].user` before writing the cleanup envelope back and before
returning hydrated state. Token extraction and SecureStore migration remain
unchanged. Malformed or non-object user values are preserved for the existing
store validation path rather than coerced into valid users.

## Error Handling

- Wallet reads retain their current loading and retry errors.
- Transfer failures keep the pending idempotency key but do not expose it in
  UI or logs.
- Best-effort legacy cleanup keeps its current error reporting and degraded
  semantics; a cleanup failure must not delete valid credentials.
- PII sanitization must not mutate the input object.

## Testing

Add regression coverage proving:

1. Wallet code contains no `/coin/recharge` mutation or purchase controls.
2. Two submissions of the same transfer intent reuse one generated key after
   an ambiguous failure.
3. Changing amount or message creates a new key.
4. Confirmed success clears the retained transfer intent.
5. Legacy auth MMKV metadata containing email, phone, social handles, birthday,
   persona, hello words, and city is rewritten without those values.
6. Legacy known-account metadata is sanitized for every account while its
   SecureStore token bundles are reconstructed unchanged.
7. Existing storage degradation, account switching, coin, typecheck, lint, and
   Node regression suites remain green.

## Non-Goals

- Implementing a payment provider or user-controlled top-up endpoint.
- Encrypting the entire application MMKV database.
- Changing backend gift transaction semantics.
- Refactoring unrelated wallet, auth, or storage code.
