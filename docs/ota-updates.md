# OTA updates

The app supports two update paths:

- JavaScript and bundled assets use Expo Updates and do not require a new APK.
- Native modules, permissions, Expo plugins, and Android/iOS configuration still
  require a signed binary. The existing in-app APK installer handles that path.

## First-time setup

Install the SDK-compatible package and create/link the EAS project:

```bash
npx expo install expo-updates
npx eas-cli@latest init
```

Create or link the EAS project, then set its public project ID as the
`EXPO_PUBLIC_EAS_PROJECT_ID` repository variable in GitHub Actions. The Android
release, preproduction, and daily release-like workflows pass that variable to
Expo config. The app config maps production builds to the `production` channel
and preproduction builds to `preview`. The first binary built with this config
must be distributed to users before OTA updates can be received.

## Publish a JavaScript update

```bash
eas update --channel production --environment production --message "Describe the change"
```

SDK 55 requires the `--environment` flag. Preview updates use the `preview`
channel and the preview EAS environment.

Publish together with the Sentry source map upload, in one chain:

```bash
npm run sourcemaps:ota:check && eas update --channel production --environment production --message "Describe the change" && npm run sourcemaps:ota
```

- `sourcemaps:ota:check` runs first because the upload happens after `eas update`
  has already published: a missing credential found only then means users already
  have an update whose crash stacks stay minified.
- `sourcemaps:ota` uploads the maps from the `dist/` directory that `eas update`
  just wrote. Keep `dist/` until it succeeds: the next `eas update` or
  `expo export` overwrites it, and those maps are then gone.
- Both need `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` exported in the
  shell (`.env` files are not read for this check); `SENTRY_URL` defaults to
  `https://sentry.io/`. The upload fails when `dist/` has no `.map` files.
- Maps are matched by debug ID, so no release or dist value is needed.

Do not bump `expo.version` for a JavaScript-only update. With the current
`runtimeVersion` policy, changing the app version creates a new native runtime.
Bump `expo.version` and `android.versionCode` only when a new binary is needed.

## Safety rules

Never publish an OTA update that imports a native module missing from the
installed binary. Build a new APK/IPA first for native changes, then publish
an update targeting that runtime. Test OTA behavior with a release or preview
build; Expo Go and development mode do not support the update APIs.
