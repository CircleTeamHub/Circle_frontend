# E2E Runtime Target and Secret Safety Design

## Context

PR #174 validates operator-supplied `E2E_API_URL` and `E2E_SOCKET_URL`, but those values do not configure or attest the installed Expo binary. A production-configured binary can therefore pass the wrapper guard while Maestro performs authenticated or mutating flows against production. The runner also places `E2E_PASSWORD` and `E2E_VERIFICATION_CODE` in Maestro `-e KEY=value` arguments, exposing them through process command lines.

## Chosen design

The application root will expose one non-interactive, non-user-visible test marker derived from the same normalized `API_URL` used by the API client. Both the app and wrapper will encode the canonical origin as lowercase UTF-16 code-unit hex and build `windnote_runtime_api_origin_<hex>`, which contains only regex-safe ASCII. A shared Maestro preflight subflow will assert that exact accessibility identifier before any authentication or mutation command. Every supported E2E and UI-performance flow will run the preflight immediately after launch, so a flow cannot bypass the check by importing a later auth subflow directly.

`run-e2e.mjs` will split public flow variables from sensitive variables. Public variables may remain Maestro `-e` arguments. `E2E_PASSWORD` and `E2E_VERIFICATION_CODE` will be removed from arguments and mapped to child-process variables `MAESTRO_E2E_PASSWORD` and `MAESTRO_E2E_VERIFICATION_CODE`. The caller-facing environment names remain unchanged, while the sign-in flow references the prefixed names that Maestro exposes from the shell. The parent environment will otherwise be preserved.

## Alternatives considered

1. Inspect build-time environment files before launch. Rejected because it does not attest the installed artifact actually launched by Maestro.
2. Probe the operator-supplied API URL from the wrapper. Rejected because reachability does not prove the installed app uses that URL.
3. Put secrets in a temporary file. Rejected because it adds filesystem cleanup and permission risks while Maestro already supports environment-backed variables.

## Components and data flow

- `src/constants/config.ts` will export the normalized runtime API origin and its deterministic marker ID derived from `API_URL`.
- `app/_layout.tsx` will render an absolute one-pixel, non-interactive accessible `View` with that `testID`, without changing layout, navigation, or production network behavior.
- `.maestro/subflows/assert-runtime-target.yaml` will compare the marker value with `E2E_API_URL` and fail before sign-in.
- Every top-level file under `.maestro/flows/` and `.maestro/performance/` will invoke launch and target assertion before other actions.
- `scripts/testing/safe-test-config.mjs` will keep validating caller inputs, compute `E2E_API_TARGET_ID` with the same encoding, and classify sensitive Maestro values separately.
- `scripts/run-e2e.mjs` will build `{ args, childEnv }`, spawn Maestro with `shell: false`, and never include a password or verification code in `args`.

## Failure behavior

A missing marker, malformed runtime origin, or origin mismatch fails the suite before credentials are entered. Empty or invalid credentials remain rejected by the existing parser. Maestro startup failures and non-zero exits retain their current errors. No secret value may be emitted in thrown errors, arguments, or diagnostics.

## Testing

- Add a RED contract test proving a production-configured runtime marker cannot satisfy a staging target assertion.
- Add a locator/flow contract test proving every top-level E2E and performance flow invokes the target assertion before auth or mutation.
- Add a RED runner test proving password and verification-code values are absent from process arguments and present only under the intended `MAESTRO_*` child environment names.
- Run `npm run test:testing-tools`, `npm run typecheck`, focused lint, and `git diff --check`.

## Success criteria

- The installed app's actual API origin is attested before any credential or mutating action.
- All supported top-level Maestro flows are covered by the preflight.
- `E2E_PASSWORD` and `E2E_VERIFICATION_CODE` never appear in Maestro argv.
- Existing E2E caller environment names and suite selection remain compatible.
