const fs = require('node:fs');
const path = require('node:path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const DISABLE_AUTO_UPLOAD_BLOCK = `if [[ -z "$SENTRY_AUTH_TOKEN" || -z "$SENTRY_ORG" || -z "$SENTRY_PROJECT" ]]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi`;
const DISABLE_AUTO_UPLOAD_PATTERN =
  /(?:if (?:\[\[ "\$CONFIGURATION" = \*Debug\* && [^\n]+ \]\]|\[\[ -z "\$SENTRY_AUTH_TOKEN"[^\n]+ \]\]|\[ -z "\$SENTRY_AUTH_TOKEN" \]); then\n\s*export SENTRY_DISABLE_AUTO_UPLOAD=true\nfi|export\s+SENTRY_DISABLE_AUTO_UPLOAD=.*)/m;

const ANDROID_UPLOAD_GUARD_MARKER = 'circle-im-sentry-local-upload-guard';
const ANDROID_UPLOAD_GUARD_BLOCK = `
// ${ANDROID_UPLOAD_GUARD_MARKER}
tasks.configureEach { task ->
    if (task.name.contains("SentryUpload")) {
        task.onlyIf {
            def hasUploadConfig = System.getenv("SENTRY_AUTH_TOKEN")?.trim() &&
                System.getenv("SENTRY_ORG")?.trim() &&
                System.getenv("SENTRY_PROJECT")?.trim()
            return hasUploadConfig
        }
    }
}
`;

function appendSentryDisableAutoUpload(content) {
  if (DISABLE_AUTO_UPLOAD_PATTERN.test(content)) {
    return content.replace(DISABLE_AUTO_UPLOAD_PATTERN, DISABLE_AUTO_UPLOAD_BLOCK);
  }

  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  return `${content}${separator}${DISABLE_AUTO_UPLOAD_BLOCK}\n`;
}

function appendAndroidSentryUploadGuard(content) {
  if (content.includes(ANDROID_UPLOAD_GUARD_MARKER)) {
    return content;
  }

  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  return `${content}${separator}${ANDROID_UPLOAD_GUARD_BLOCK}`;
}

function withLocalSentryAutoUploadDisabled(config) {
  const withIosGuard = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const envPath = path.join(modConfig.modRequest.platformProjectRoot, '.xcode.env');
      const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      const next = appendSentryDisableAutoUpload(current);

      if (next !== current) {
        fs.writeFileSync(envPath, next);
      }

      return modConfig;
    },
  ]);

  return withAppBuildGradle(withIosGuard, (modConfig) => {
    if (modConfig.modResults.language === 'groovy') {
      modConfig.modResults.contents = appendAndroidSentryUploadGuard(
        modConfig.modResults.contents,
      );
    }

    return modConfig;
  });
}

module.exports = withLocalSentryAutoUploadDisabled;
module.exports.appendSentryDisableAutoUpload = appendSentryDisableAutoUpload;
module.exports.appendAndroidSentryUploadGuard = appendAndroidSentryUploadGuard;
