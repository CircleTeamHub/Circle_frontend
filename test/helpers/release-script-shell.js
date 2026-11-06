const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function releaseScriptShell({
  platform = process.platform,
  env = process.env,
  existsSync = fs.existsSync,
  canRun = (command) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0,
} = {}) {
  if (platform !== 'win32') return 'bash';
  if (env.GIT_BASH_PATH && existsSync(env.GIT_BASH_PATH)) return env.GIT_BASH_PATH;
  const candidates = [
    env.ProgramFiles && path.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean);
  const installed = candidates.find(existsSync);
  if (installed) return installed;
  if (canRun('bash')) return 'bash';
  throw new Error('Git Bash is required; set GIT_BASH_PATH or add bash to PATH');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

module.exports = { releaseScriptShell, shellQuote };
