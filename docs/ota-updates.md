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

Set `EXPO_PUBLIC_EAS_PROJECT_ID` in the production and preview build
environments. The app config maps production builds to the `production` channel
and preproduction builds to `preview`. The first binary built with this config
must be distributed to users before OTA updates can be received.

## Publish a JavaScript update

```bash
eas update --channel production --environment production --message "Describe the change"
```

SDK 55 requires the `--environment` flag. Preview updates use the `preview`
channel and the preview EAS environment.

Do not bump `expo.version` for a JavaScript-only update. With the current
`runtimeVersion` policy, changing the app version creates a new native runtime.
Bump `expo.version` and `android.versionCode` only when a new binary is needed.

## Safety rules

Never publish an OTA update that imports a native module missing from the
installed binary. Build a new APK/IPA first for native changes, then publish
an update targeting that runtime. Test OTA behavior with a release or preview
build; Expo Go and development mode do not support the update APIs.
