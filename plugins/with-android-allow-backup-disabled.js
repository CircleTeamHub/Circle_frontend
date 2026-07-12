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

function disableAndroidAllowBackup(androidManifest) {
  const mainApplication =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  mainApplication.$['android:allowBackup'] = 'false';
  mainApplication.$['android:fullBackupContent'] = BACKUP_RULES_RESOURCE;
  mainApplication.$['android:dataExtractionRules'] =
    DATA_EXTRACTION_RULES_RESOURCE;
  return androidManifest;
}

function withAndroidAllowBackupDisabled(config) {
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
}

module.exports = withAndroidAllowBackupDisabled;
module.exports.disableAndroidAllowBackup = disableAndroidAllowBackup;
module.exports.writeAndroidBackupRuleFiles = writeAndroidBackupRuleFiles;
