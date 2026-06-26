const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const DISABLE_AUTO_UPLOAD_BLOCK = `if [ -z "$SENTRY_AUTH_TOKEN" ]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi`;
const DISABLE_AUTO_UPLOAD_PATTERN =
  /(?:if \[ -z "\$SENTRY_AUTH_TOKEN" \]; then\n\s*export SENTRY_DISABLE_AUTO_UPLOAD=true\nfi|export\s+SENTRY_DISABLE_AUTO_UPLOAD=.*)/m;

function appendSentryDisableAutoUpload(content) {
  if (DISABLE_AUTO_UPLOAD_PATTERN.test(content)) {
    return content.replace(DISABLE_AUTO_UPLOAD_PATTERN, DISABLE_AUTO_UPLOAD_BLOCK);
  }

  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  return `${content}${separator}${DISABLE_AUTO_UPLOAD_BLOCK}\n`;
}

function withLocalSentryAutoUploadDisabled(config) {
  return withDangerousMod(config, [
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
}

module.exports = withLocalSentryAutoUploadDisabled;
module.exports.appendSentryDisableAutoUpload = appendSentryDisableAutoUpload;
