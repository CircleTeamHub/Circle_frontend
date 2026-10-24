#!/usr/bin/env node
// 校验 `expo prebuild --platform ios` 产出的 iOS 工程里，Sentry 的符号上传接线还在：
// - ios/.xcode.env 带着插件写入的守卫（Release 缺凭据就让构建失败，而不是静默跳过）；
// - 工程里有 Sentry 的 debug 符号上传阶段，JS bundle 阶段被 sentry-xcode.sh 包住。
// 没有 iOS 发版 CI，这一步至少保证「配置层面」不会被悄悄改坏。不需要 Xcode。
const fs = require('node:fs');
const path = require('node:path');

const iosDir = path.join(process.cwd(), 'ios');
const problems = [];

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    problems.push(`${path.relative(process.cwd(), file)} not found — did prebuild run?`);
    return '';
  }
}

const xcodeEnv = read(path.join(iosDir, '.xcode.env'));
for (const needle of [
  'circle-im-sentry-upload-config-guard:start',
  '*Release*',
  'exit 1',
  'SENTRY_DISABLE_AUTO_UPLOAD',
]) {
  if (xcodeEnv && !xcodeEnv.includes(needle)) {
    problems.push(`ios/.xcode.env is missing the Sentry upload guard (${needle})`);
  }
}

const projects = fs.existsSync(iosDir)
  ? fs.readdirSync(iosDir).filter((entry) => entry.endsWith('.xcodeproj'))
  : [];
if (projects.length === 0) problems.push('no .xcodeproj under ios/');
for (const project of projects) {
  const pbxproj = read(path.join(iosDir, project, 'project.pbxproj'));
  for (const needle of ['Upload Debug Symbols to Sentry', 'sentry-xcode.sh']) {
    if (pbxproj && !pbxproj.includes(needle)) {
      problems.push(`${project} has no "${needle}" build phase`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}
console.log('OK: iOS Sentry upload guard and symbol upload phases are present');
