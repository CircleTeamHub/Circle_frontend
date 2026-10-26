const fs = require('node:fs');
const path = require('node:path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const IOS_UPLOAD_GUARD_MARKER = 'circle-im-sentry-upload-config-guard';
// Release 构建（不论本地还是 CI/EAS）缺 Sentry 凭据直接失败：本地打的 Release 包同样会
// 被分发，静默跳过上传的话，那个版本的崩溃栈在 Sentry 里永远符号化不了。
//
// 确实不分发的本地 Release 构建要显式声明 SENTRY_DISABLE_AUTO_UPLOAD=true（与 Android
// 守卫同一个逃生口）：启动构建时的环境变量 / xcodebuild 构建设置都行；从 Xcode 界面
// 启动的 Profile / Archive 带不进环境变量，所以这里也认同目录 .xcode.env.local 里的
// `export SENTRY_DISABLE_AUTO_UPLOAD=true` —— 它本身在这段之后才被 source，只能先 grep。
// Debug 构建缺凭据照旧静默跳过。
//
// 凭据只判断「有没有」（${VAR:+set}）：sentry-xcode-debug-files.sh 先 set -x 再 source
// 本文件，展开原值会把令牌打进构建日志。
const DISABLE_AUTO_UPLOAD_BLOCK = `# ${IOS_UPLOAD_GUARD_MARKER}:start
__sentry_guard_env_local="$(dirname "\${BASH_SOURCE[0]:-$0}")/.xcode.env.local"
if [[ "\${SENTRY_DISABLE_AUTO_UPLOAD:-}" != "true" && -f "$__sentry_guard_env_local" ]] \\
  && grep -Eq '^[[:space:]]*export[[:space:]]+SENTRY_DISABLE_AUTO_UPLOAD=true[[:space:]]*$' "$__sentry_guard_env_local"; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi
unset __sentry_guard_env_local
if [[ "\${SENTRY_DISABLE_AUTO_UPLOAD:-}" == "true" ]]; then
  if [[ "\${CONFIGURATION:-}" == *Release* ]]; then
    echo "warning: Sentry symbol upload is disabled (SENTRY_DISABLE_AUTO_UPLOAD=true); do not distribute this build." >&2
  fi
elif [[ -z "\${SENTRY_AUTH_TOKEN:+set}" || -z "\${SENTRY_ORG:+set}" || -z "\${SENTRY_PROJECT:+set}" ]]; then
  if [[ "\${CONFIGURATION:-}" == *Release* ]]; then
    echo "error: Sentry upload config is required for Release builds. Set SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT. For a build that is never distributed, set SENTRY_DISABLE_AUTO_UPLOAD=true: in the environment, as an xcodebuild build setting, or as 'export SENTRY_DISABLE_AUTO_UPLOAD=true' in ios/.xcode.env.local." >&2
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
    // 替换函数而不是字符串：块里的 shell 有 `$'` 这类 replace 特殊序列。
    return content.replace(DISABLE_AUTO_UPLOAD_PATTERN, () => DISABLE_AUTO_UPLOAD_BLOCK);
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
