# Registration Invite Code Design

**Date:** 2026-07-15  
**Status:** Approved for implementation planning  
**Repositories:** `circle-im`, `circle_be`

## Goal

Allow a user to optionally enter an invite code during registration. A valid code records the existing user who invited the new user. Omitting the code preserves the current registration flow.

## Product Decisions

- The field appears directly on the registration form as **Invite code (optional)**.
- Invite codes apply only to registration, not password or verification-code login.
- Every user owns one stable, unique invite code.
- Changing an account ID does not change the invite code.
- Invalid invite codes stop registration and produce a localized, actionable error.
- Invitation rewards, counts, leaderboards, expiration, revocation, and admin tooling are out of scope.

## Data Model

Extend the backend `User` model with:

- `inviteCode String @unique`: the user's immutable public invite code.
- `invitedByUserId String?`: the inviter's user ID, if one was supplied at registration.
- A named self-relation from `invitedBy` to `invitees`.

The migration will copy each existing user's current unique `accountId` into `inviteCode`, then make `inviteCode` required and unique. New registrations generate one unique account ID and initially use the same value for both `accountId` and `inviteCode`. The two fields are independent afterward, so later account-ID changes do not invalidate existing invite codes.

Deleting an inviter must not delete invitees. The foreign key therefore uses `ON DELETE SET NULL`.

## Backend Registration Flow

`RegisterDto` accepts optional `inviteCode`. The value is trimmed and normalized to lowercase before lookup. The existing account-ID character rules are reused so stored and submitted codes have one canonical format.

Registration keeps its current email verification and duplicate-email checks. If an invite code is present, `AuthService.register()` then looks up an active user with that code:

- A match adds `invitedByUserId` to the new user's create data.
- No match, or a non-active inviter, returns HTTP 400 with stable error code `AUTH_INVITE_CODE_INVALID`.
- An absent or whitespace-only value behaves as no invite code.

The new user is created once with `accountId`, `inviteCode`, and optional inviter relationship. Token issuance and OpenIM synchronization remain unchanged.

The safe current-user response includes `inviteCode`, allowing authenticated clients to display it. It does not need to expose `invitedByUserId` for this feature.

## Frontend Flow

The registration screen adds an `AuthInput` between nickname and the agreement checkbox:

- Label and placeholder communicate that the field is optional.
- The value is held in local form state.
- Client validation accepts an empty value; a non-empty value must follow the same invite-code format as the backend.
- The auth hook trims the value and passes it to the API layer.
- The API request omits `inviteCode` when the trimmed value is empty.

`BackendAuthUser` and the local auth user type include the returned `inviteCode`. The existing share screen replaces its hard-coded code with `user.inviteCode`; if an old or incomplete session has no code, the copy action is unavailable and the screen shows a localized fallback rather than copying a fake value.

All supported locale files receive the new registration labels and `AUTH_INVITE_CODE_INVALID` message.

## Errors and Compatibility

- Old clients remain compatible because `inviteCode` is optional in the request.
- Existing users receive codes through the migration.
- Invalid invite codes never create a user.
- The frontend uses the backend error code for localized messaging and retains the existing generic registration failure fallback.
- No invitation code or relationship is written to logs beyond existing structured registration metadata.

## Testing

Backend tests cover:

- DTO acceptance of an omitted or valid invite code and rejection of malformed input.
- Registration without a code.
- Registration with a valid active inviter and persisted relationship.
- Rejection of unknown and inactive invite codes using `AUTH_INVITE_CODE_INVALID`.
- Migration shape and safe-user exposure of `inviteCode`.

Frontend tests cover:

- Optional invite-code validation.
- API omission for blank input and normalized submission for populated input.
- Auth-hook forwarding.
- Registration-screen field wiring.
- Share-screen removal of the hard-coded code and use of the authenticated user's code.

Verification will run targeted tests first, then each repository's typecheck/lint/test commands appropriate to the changed surface.
