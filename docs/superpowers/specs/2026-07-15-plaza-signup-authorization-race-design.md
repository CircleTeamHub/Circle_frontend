# Plaza Signup Authorization Race Design

## Goal

Prevent a user whose linked-circle membership is concurrently revoked from
creating a new plaza post signup after authorization has become invalid.

## Target

Implement in `circle_be` on a branch based on
`origin/agent/fix-plaza-signup-membership` (`b86c2d3`). Preserve the branch's
linked-circle membership semantics and port only the race closure already
demonstrated by sibling commit `b0b4215`.

## Authorization and Idempotency Semantics

The initial post read continues to enforce active/unexpired visibility and
loads whether the caller belongs to at least one active, non-deleted linked
circle. Existing signups remain idempotent even if membership was later lost;
this avoids turning a harmless retry into a misleading authorization error.

For a new signup, run the mutation in the repository's serializable transaction
helper. Inside that transaction, immediately before `CirclePostSignup.create`,
re-read the post using all of these predicates:

- post is active and unexpired;
- post ID matches the requested post;
- at least one linked circle is not deleted;
- that circle has an ACTIVE membership for the caller.

If the row no longer matches, return the existing `PostNotFound` response. The
transaction then creates the signup and increments `signupCount` atomically.
Serializable retry behavior handles concurrent membership or signup writes;
the existing unique-key handling continues suppressing duplicate signups.

## Privacy and Error Handling

Use the existing not-found error rather than revealing whether the post,
circle, or membership exists. Do not add a separate forbidden response. Do not
change notification behavior: notifications run only after a committed new
signup.

## Testing

Add or preserve regression coverage proving:

1. the transaction uses serializable isolation;
2. the in-transaction query contains the linked-circle ACTIVE membership
   predicate;
3. a simulated membership loss between the initial check and transaction
   rejects without creating a signup or incrementing the count;
4. an existing signup remains idempotent after membership loss;
5. ACTIVE membership in a secondary linked circle remains sufficient when the
   primary circle is deleted;
6. pending, rejected, deleted-circle-only, and unrelated-circle memberships are
   rejected;
7. focused unit tests, TypeScript checks, lint, and the guarded E2E signup suite
   pass.

## Non-Goals

- Changing plaza post visibility rules.
- Removing an existing signup when membership is revoked.
- Modifying signup VIP, credit, or fancy-number restrictions.
- Combining this application authorization fix with release infrastructure.
