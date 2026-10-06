# Merged review remediation plan

## Goal

Close every still-open finding from the rolling seven-day merged-code review in
`Circle_frontend` and `circle_be`, without changing remote state.

## Frontend

1. Treat transport-level registration failures as ambiguous, add regression
   coverage, and keep explicit 4xx responses as definite failures.
2. Replace the unsupported `expo-amap` bridge with `expo-gaode-map`, use
   platform-specific keys and the package's actual camera/ref APIs, and verify
   config plus fallback behavior.

## Backend

1. Accept and deliver JPush registrations server-side, with provider-aware DTO
   validation, configuration validation, batching, retry classification, and
   focused tests.
2. Serialize circle invite-policy changes and circle QR/invitation joins on the
   same conversation row, then re-read policy inside the transaction.
3. Add a forward-only compatibility migration that fills self-destruct start
   boundaries for old binaries during rolling deploys.
4. Apply each recipient's account-level self-destruct policy to chat push body
   redaction and TTL, using one batched policy query.
5. Make release deployment fail closed when the known blocking
   `ChatMessage.deletedAt` migration is pending without downtime mode.

## Verification and delivery

Run focused regression tests first, then repository typecheck/lint and the
relevant broader test suites. Review both diffs, create one clear local commit
per repository, and record the result in automation memory. Do not push or open
pull requests.
