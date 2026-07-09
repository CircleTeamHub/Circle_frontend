# Backup Exclusion Hardening Design

## Context

The branch disables Android backups and marks the iOS OpenIM directory as
excluded from backup. The production review found two gaps:

1. Android 12+ device-to-device migration can ignore `android:allowBackup=false`
   on some devices, while the branch only tests that manifest attribute.
2. An unrelated commit reintroduces `as Href` casts for the Discover
   notification-center route.

## Decisions

### Android backup policy

Keep `android:allowBackup=false` as the primary, app-wide privacy policy. Add
project-owned backup rule resources as a defense in depth for transports that
ignore the flag.

The config plugin will generate and bind both Android rule formats:

- Android 11 and lower: `@xml/windnote_backup_rules` through
  `android:fullBackupContent`.
- Android 12 and higher: `@xml/windnote_data_extraction_rules` through
  `android:dataExtractionRules`.

Both cloud and device-transfer rules will exclude:

- `file/openim`, containing the OpenIM message database and logs.
- `file/mmkv`, containing the app's MMKV-backed metadata and preferences.
- `sharedpref/SecureStore`, containing Expo SecureStore ciphertext that is not
  portable across device keystores.

The plugin will own these resources instead of depending on the transitive
`expo-secure-store` rule files. It will write deterministic XML during Expo
prebuild and overwrite the manifest references after earlier plugins run.

### iOS policy

Keep the existing `NSURLIsExcludedFromBackupKey=true` behavior for the OpenIM
directory. Initialization remains fail-closed if iOS cannot apply the resource
attribute.

### Typed routes

Remove the two `as Href` casts and the now-unused type import. The literal route
must compile through Expo typed routes. A regression test will reject future
`as Href` casts in both navigation call sites.

## Testing

Tests will verify:

1. The introspected Android manifest has `allowBackup=false` and references the
   two Windnote-owned XML resources.
2. The plugin writes both XML files into a temporary Android project and each
   relevant backup mode excludes OpenIM, MMKV, and SecureStore.
3. Both Discover notification-center call sites contain no `as Href` cast.
4. The existing iOS OpenIM directory exclusion test remains green.
5. Full typecheck, lint, Expo config validation, Node tests, and behavior tests
   pass before the branch is considered ready.

## Scope

This change does not alter application data paths, migrate existing data, or
enable selective backup for other app state. It only hardens backup exclusion
and restores typed-route enforcement.
