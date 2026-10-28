# iOS CI and TestFlight inspection

`eas.json` pins the production EAS profile, remote iOS build-number allocation, and the iOS builder size. Circle's iOS release path has two separate jobs:

- `.github/workflows/ios-release.yml` runs the normal application CI, regenerates the iOS native project, verifies the Sentry upload guard and Bundle ID, and builds an IPA with EAS. Scheduled runs and `v*` tags submit the exact downloaded IPA to TestFlight. A manual run builds only unless `publish=true` is selected.
- `.github/workflows/ios-testflight-inspection.yml` runs every 15 minutes and checks that each configured TestFlight beta group belongs to `com.yiboding.circleim`. A missing group produces a `NOT_FOUND` failure; a group attached to another App produces a configuration failure. The workflow can send the same failure summary to `RELEASE_FEISHU_WEBHOOK_URL`.

Required repository configuration:

- Variable `EXPO_PUBLIC_EAS_PROJECT_ID` and secret `EAS_TOKEN` for EAS builds/submissions.
- Variables used by the app build: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_CHAT_WS_URL`, `EXPO_PUBLIC_MEDIA_ORIGINS`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_JPUSH_APP_KEY`, `EXPO_PUBLIC_PUSH_PROVIDER`, and `EXPO_PUBLIC_AMAP_IOS_KEY` as applicable.
- Sentry build credentials: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT`.
- Inspection variables `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_ISSUER_ID`, `IOS_TESTFLIGHT_GROUP_IDS` (comma-separated Apple beta-group IDs), and secret `APP_STORE_CONNECT_API_KEY_BASE64` containing the App Store Connect `.p8` key. `RELEASE_FEISHU_WEBHOOK_URL` is optional.

The inspection does not submit builds or change TestFlight distribution. It only reads the App Store Connect App and beta-group resources and reports mismatches.
