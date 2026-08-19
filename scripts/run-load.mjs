import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseLoadConfig,
  supportedLoadScenarios,
} from './testing/safe-test-config.mjs';

export function buildK6Args(config) {
  return ['run', config.script];
}

export function runLoadScenario(scenarioName, env = process.env) {
  const config = parseLoadConfig(env, scenarioName);
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const accountsPath = path.resolve(root, config.accountsFile);
  if (!existsSync(accountsPath)) {
    throw new Error('LOAD_ACCOUNTS_FILE does not exist.');
  }
  const executable = env.K6_BIN?.trim() || 'k6';
  const result = spawnSync(executable, buildK6Args(config), {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: {
      ...env,
      ...config.k6Env,
      LOAD_ACCOUNTS_FILE: accountsPath,
    },
  });
  if (result.error) {
    throw new Error(`Unable to start k6. Set K6_BIN to its executable: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`k6 scenario ${scenarioName} exited with status ${result.status}.`);
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const scenarioName = argv[0];
  if (!scenarioName || !supportedLoadScenarios.includes(scenarioName)) {
    throw new Error(`Choose one load scenario: ${supportedLoadScenarios.join(', ')}.`);
  }
  runLoadScenario(scenarioName, env);
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
