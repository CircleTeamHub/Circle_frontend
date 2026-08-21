import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseE2EConfig,
  supportedE2ESuites,
} from './testing/safe-test-config.mjs';

const ALL_SUITES = [
  'smoke',
  'auth-navigation',
  'chat-message',
  'moment-lifecycle',
  'profile-settings',
  'social-circle',
];

export function buildMaestroArgs(config) {
  const envArgs = Object.entries(config.maestroEnv).flatMap(([name, value]) => [
    '-e',
    `${name}=${value}`,
  ]);
  const deviceArgs = config.deviceId ? ['--device', config.deviceId] : [];
  return [...deviceArgs, 'test', ...envArgs, config.flow];
}

export function buildMaestroInvocation(config, parentEnv = process.env) {
  const childEnv = { ...parentEnv };
  for (const name of [
    'E2E_PASSWORD',
    'E2E_VERIFICATION_CODE',
    'MAESTRO_E2E_PASSWORD',
    'MAESTRO_E2E_VERIFICATION_CODE',
  ]) {
    delete childEnv[name];
  }
  Object.assign(childEnv, config.maestroSecretEnv);
  return {
    args: buildMaestroArgs(config),
    env: childEnv,
  };
}

export function runE2ESuite(suiteName, env = process.env) {
  const config = parseE2EConfig(env, suiteName);
  const executable = env.MAESTRO_BIN?.trim() || 'maestro';
  const invocation = buildMaestroInvocation({
    ...config,
    deviceId: env.MAESTRO_DEVICE_ID?.trim() || undefined,
  }, env);
  const result = spawnSync(executable, invocation.args, {
    cwd: path.resolve(fileURLToPath(new URL('..', import.meta.url))),
    stdio: 'inherit',
    shell: false,
    env: invocation.env,
  });
  if (result.error) {
    throw new Error(`Unable to start Maestro. Set MAESTRO_BIN to its executable: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Maestro suite ${suiteName} exited with status ${result.status}.`);
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const suiteName = argv[0] || 'smoke';
  const suites = suiteName === 'all' ? ALL_SUITES : [suiteName];
  for (const suite of suites) {
    if (!supportedE2ESuites.includes(suite)) {
      throw new Error(`Unknown E2E suite: ${suite}.`);
    }
    runE2ESuite(suite, env);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
