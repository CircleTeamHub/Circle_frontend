# Backup Exclusion Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android backup exclusion independent of transitive plugin behavior and restore Expo typed-route enforcement.

**Architecture:** The existing Android config plugin remains the single owner of the backup policy. It will set the manifest attributes and use an Android dangerous mod to write deterministic Android 11 and Android 12+ XML rule resources. The route fix removes type assertions and is protected by a source regression test plus TypeScript compilation.

**Tech Stack:** Expo SDK 55 config plugins and XML utilities, Node.js `node:test`, TypeScript, Expo Router typed routes.

## Global Constraints

- Keep `android:allowBackup=false` as the primary app-wide policy.
- Explicitly exclude `file/openim`, `file/mmkv`, and `sharedpref/SecureStore` from Android backup rules.
- Cover Android 11 and lower through `fullBackupContent` and Android 12+ cloud/device transfer through `dataExtractionRules`.
- Do not change the OpenIM, MMKV, or SecureStore runtime paths.
- Do not introduce new dependencies.
- Remove both Discover notification-center `as Href` casts.

---

### Task 1: Own Android backup rule artifacts

**Files:**
- Modify: `test/native-branding-config.test.js`
- Modify: `plugins/with-android-allow-backup-disabled.js`
- Modify: `docs/client-security-remediation-plan.md`

**Interfaces:**
- Consumes: Expo `withAndroidManifest` and `withDangerousMod` config-plugin APIs.
- Produces: `writeAndroidBackupRuleFiles(projectRoot): Promise<void>` and generated resources `windnote_backup_rules.xml` / `windnote_data_extraction_rules.xml`.

- [x] **Step 1: Write the failing manifest ownership test**

Update `android prebuild manifest disables platform backups for local chat data` to assert:

```js
assert.equal(applicationAttributes['android:allowBackup'], 'false');
assert.equal(
  applicationAttributes['android:fullBackupContent'],
  '@xml/windnote_backup_rules',
);
assert.equal(
  applicationAttributes['android:dataExtractionRules'],
  '@xml/windnote_data_extraction_rules',
);
```

- [x] **Step 2: Run the manifest test to verify RED**

Run:

```bash
node --test --test-name-pattern="android prebuild manifest" test/native-branding-config.test.js
```

Expected: FAIL because the manifest still points to `@xml/secure_store_backup_rules` and `@xml/secure_store_data_extraction_rules`.

- [x] **Step 3: Write the failing artifact-content test**

Add `os` and Expo XML utility imports, then add a test that creates a temporary
project root, calls the exported writer, parses both generated XML files, and
checks the exact exclusions:

```js
const os = require('node:os');
const {
  parseXMLAsync,
} = require('@expo/config-plugins/build/utils/XML');

test('owned Android backup rules exclude device-bound local data', async () => {
  const projectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'windnote-backup-rules-'),
  );
  const plugin = require('../plugins/with-android-allow-backup-disabled');
  const expectedExcludes = [
    { domain: 'file', path: 'openim' },
    { domain: 'file', path: 'mmkv' },
    { domain: 'sharedpref', path: 'SecureStore' },
  ];

  try {
    assert.equal(typeof plugin.writeAndroidBackupRuleFiles, 'function');
    await plugin.writeAndroidBackupRuleFiles(projectRoot);

    const xmlDir = path.join(
      projectRoot,
      'android',
      'app',
      'src',
      'main',
      'res',
      'xml',
    );
    const [legacyXml, modernXml] = await Promise.all([
      fs.promises.readFile(
        path.join(xmlDir, 'windnote_backup_rules.xml'),
        'utf8',
      ),
      fs.promises.readFile(
        path.join(xmlDir, 'windnote_data_extraction_rules.xml'),
        'utf8',
      ),
    ]);
    const [legacyRules, modernRules] = await Promise.all([
      parseXMLAsync(legacyXml),
      parseXMLAsync(modernXml),
    ]);
    const attributes = (rules) => rules.map((rule) => rule.$);

    assert.deepEqual(
      attributes(legacyRules['full-backup-content'].exclude),
      expectedExcludes,
    );
    assert.deepEqual(
      attributes(
        modernRules['data-extraction-rules']['cloud-backup'][0].exclude,
      ),
      expectedExcludes,
    );
    assert.deepEqual(
      attributes(
        modernRules['data-extraction-rules']['device-transfer'][0].exclude,
      ),
      expectedExcludes,
    );
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
```

- [x] **Step 4: Run the artifact test to verify RED**

Run:

```bash
node --test --test-name-pattern="owned Android backup rules" test/native-branding-config.test.js
```

Expected: FAIL because `writeAndroidBackupRuleFiles` is not exported yet.

- [x] **Step 5: Implement deterministic Android rule generation**

In `plugins/with-android-allow-backup-disabled.js`:

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

const BACKUP_RULES_RESOURCE = '@xml/windnote_backup_rules';
const DATA_EXTRACTION_RULES_RESOURCE =
  '@xml/windnote_data_extraction_rules';
```

Define the XML payloads and writer exactly as follows:

```js
const BACKUP_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="file" path="openim" />
  <exclude domain="file" path="mmkv" />
  <exclude domain="sharedpref" path="SecureStore" />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="file" path="openim" />
    <exclude domain="file" path="mmkv" />
    <exclude domain="sharedpref" path="SecureStore" />
  </cloud-backup>
  <device-transfer>
    <exclude domain="file" path="openim" />
    <exclude domain="file" path="mmkv" />
    <exclude domain="sharedpref" path="SecureStore" />
  </device-transfer>
</data-extraction-rules>
`;

async function writeAndroidBackupRuleFiles(projectRoot) {
  const xmlDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'res',
    'xml',
  );
  await fs.mkdir(xmlDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(xmlDir, 'windnote_backup_rules.xml'),
      BACKUP_RULES_XML,
      'utf8',
    ),
    fs.writeFile(
      path.join(xmlDir, 'windnote_data_extraction_rules.xml'),
      DATA_EXTRACTION_RULES_XML,
      'utf8',
    ),
  ]);
}
```

Set all three manifest attributes in `disableAndroidAllowBackup`:

```js
mainApplication.$['android:allowBackup'] = 'false';
mainApplication.$['android:fullBackupContent'] = BACKUP_RULES_RESOURCE;
mainApplication.$['android:dataExtractionRules'] =
  DATA_EXTRACTION_RULES_RESOURCE;
```

Register the writer after `withAndroidManifest`:

```js
const configWithManifest = withAndroidManifest(config, (modConfig) => {
  modConfig.modResults = disableAndroidAllowBackup(modConfig.modResults);
  return modConfig;
});

return withDangerousMod(configWithManifest, [
  'android',
  async (modConfig) => {
    await writeAndroidBackupRuleFiles(modConfig.modRequest.projectRoot);
    return modConfig;
  },
]);
```

Export `writeAndroidBackupRuleFiles` for direct artifact testing:

```js
module.exports.writeAndroidBackupRuleFiles = writeAndroidBackupRuleFiles;
```

- [x] **Step 6: Run Android tests to verify GREEN**

Run:

```bash
node --test test/native-branding-config.test.js
```

Expected: all tests PASS, including manifest ownership and both XML formats.

- [x] **Step 7: Update the security remediation record**

Update the 2026-07-04 C-06 section in `docs/client-security-remediation-plan.md` to state that the project-owned rules explicitly exclude OpenIM, MMKV, and SecureStore for cloud backup and device transfer, including transports that ignore `allowBackup=false`.

- [x] **Step 8: Commit Task 1**

```bash
git add plugins/with-android-allow-backup-disabled.js test/native-branding-config.test.js docs/client-security-remediation-plan.md docs/superpowers/plans/2026-07-09-backup-exclusion-hardening.md
git commit -m "fix(android): own backup exclusion rules"
```

### Task 2: Restore Expo typed-route enforcement

**Files:**
- Modify: `test/snackbar-route.test.js`
- Modify: `src/features/discover/screens/DiscoverScreen.tsx`
- Modify: `src/features/notifications/utils/snackbar-route.ts`

**Interfaces:**
- Consumes: Expo Router generated `Href` route union.
- Produces: literal notification-center navigation accepted without assertions.

- [ ] **Step 1: Write the failing regression test**

Add:

```js
test('notification center routes stay checked by Expo typed routes', () => {
  const files = [
    'src/features/notifications/utils/snackbar-route.ts',
    'src/features/discover/screens/DiscoverScreen.tsx',
  ];

  for (const rel of files) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    assert.doesNotMatch(source, /\bas\s+Href\b/);
  }
});
```

- [ ] **Step 2: Run the route test to verify RED**

Run:

```bash
node --test --test-name-pattern="notification center routes stay checked" test/snackbar-route.test.js
```

Expected: FAIL because both source files currently contain `as Href`.

- [ ] **Step 3: Remove both route assertions**

Change `DiscoverScreen.tsx` to import only `useRouter` and push the literal route directly. Change `snackbar-route.ts` to return the literal Discover route without an assertion.

- [ ] **Step 4: Run route test and typecheck to verify GREEN**

Run:

```bash
node --test test/snackbar-route.test.js
npm run typecheck
```

Expected: all route tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/features/discover/screens/DiscoverScreen.tsx src/features/notifications/utils/snackbar-route.ts test/snackbar-route.test.js
git commit -m "fix(routes): restore notification typed routes"
```

### Task 3: Production verification

**Files:**
- Verify: all files changed by Tasks 1 and 2.

**Interfaces:**
- Consumes: committed Task 1 and Task 2 changes.
- Produces: evidence that the branch is ready for PR creation.

- [ ] **Step 1: Run the complete CI command**

Run:

```bash
npm run ci
```

Expected: typecheck, Expo config, lint, Node tests, and behavior tests all exit 0.

- [ ] **Step 2: Inspect final Git state**

Run:

```bash
git diff --check origin/main...HEAD
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: no whitespace errors, a clean worktree, and only backup-hardening / typed-route commits beyond the existing branch commits.

- [ ] **Step 3: Review the production diff**

Run:

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- app.json plugins/with-android-allow-backup-disabled.js src/im/client.ts src/features/discover/screens/DiscoverScreen.tsx src/features/notifications/utils/snackbar-route.ts test/native-branding-config.test.js test/im-client.test.js test/snackbar-route.test.js
```

Expected: all changes trace to backup exclusion, iOS backup marking, typed routes, or their tests.
