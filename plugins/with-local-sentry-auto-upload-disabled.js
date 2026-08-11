const fs = require('node:fs');
const path = require('node:path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const IOS_UPLOAD_GUARD_MARKER = 'circle-im-sentry-upload-config-guard';
const DISABLE_AUTO_UPLOAD_BLOCK = `# ${IOS_UPLOAD_GUARD_MARKER}:start
if [[ -z "$SENTRY_AUTH_TOKEN" || -z "$SENTRY_ORG" || -z "$SENTRY_PROJECT" ]]; then
  if [[ "$CONFIGURATION" == *Release* && ( -n "\${CI:-}" || -n "\${EAS_BUILD:-}" ) ]]; then
    echo "Sentry upload config is required for CI/EAS Release archives." >&2
    exit 1
  fi
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi
# ${IOS_UPLOAD_GUARD_MARKER}:end`;
const DISABLE_AUTO_UPLOAD_PATTERN =
  new RegExp(
    `(?:# ${IOS_UPLOAD_GUARD_MARKER}:start[\\s\\S]*?# ${IOS_UPLOAD_GUARD_MARKER}:end|if (?:\\[\\[ "\\$CONFIGURATION" = \\*Debug\\* && [^\\n]+ \\]\\]|\\[\\[ -z "\\$SENTRY_AUTH_TOKEN"[^\\n]+ \\]\\]|\\[ -z "\\$SENTRY_AUTH_TOKEN" \\]); then\\n\\s*export SENTRY_DISABLE_AUTO_UPLOAD=true\\nfi|export\\s+SENTRY_DISABLE_AUTO_UPLOAD=.*)`,
    'm',
  );

const ANDROID_UPLOAD_GUARD_MARKER = 'circle-im-sentry-local-upload-guard';
const ANDROID_UPLOAD_GUARD_BLOCK = `
// ${ANDROID_UPLOAD_GUARD_MARKER}
tasks.configureEach { task ->
    if (task.name.contains("SentryUpload")) {
        task.onlyIf {
            // 这道守卫抓的是「忘了配」。显式声明不上传的构建（每日校验构建：一次性
            // 签名、产物永不分发）不是事故，把它的 debug 文件传上去反而会在 Sentry
            // 里凭空多出一个并不存在的 release。SENTRY_DISABLE_AUTO_UPLOAD 也正是
            // sentry.gradle 自己的 shouldSentryAutoUploadGeneral() 读的那个变量。
            if (System.getenv("SENTRY_DISABLE_AUTO_UPLOAD")?.trim() == "true") {
                return false
            }
            def hasUploadConfig = System.getenv("SENTRY_AUTH_TOKEN")?.trim() &&
                System.getenv("SENTRY_ORG")?.trim() &&
                System.getenv("SENTRY_PROJECT")?.trim()
            def isCiOrEasBuild = System.getenv("CI")?.trim() ||
                System.getenv("EAS_BUILD")?.trim()
            if (!hasUploadConfig && isCiOrEasBuild && task.name.contains("Release")) {
                throw new GradleException("Sentry upload config is required for CI/EAS Release builds. " +
                    "Set SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT, or set " +
                    "SENTRY_DISABLE_AUTO_UPLOAD=true for builds that are never distributed.")
            }
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
