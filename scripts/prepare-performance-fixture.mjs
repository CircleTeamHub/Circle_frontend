import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAccounts, summarizeAccounts } from '../load-tests/lib/data.js';

export function buildPerformanceFixture(accounts) {
  const parsed = parseAccounts(accounts);
  const conversationIds = [...new Set(parsed.flatMap((account) => account.conversationIds))];
  if (conversationIds.length < 2) {
    throw new Error('At least two seeded conversationIds are required for UI performance flows.');
  }
  return {
    generatedAt: new Date().toISOString(),
    accounts: summarizeAccounts(parsed),
    conversationCount: conversationIds.length,
    E2E_PERF_CONVERSATION_ID: conversationIds[0],
    E2E_PERF_SECOND_CONVERSATION_ID: conversationIds[1],
  };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  if (env.LOAD_PERFORMANCE_FIXTURE !== 'true') {
    throw new Error('LOAD_PERFORMANCE_FIXTURE=true is required.');
  }
  const input = argv[0];
  if (!input) throw new Error('Pass the local load account JSON file.');
  const accounts = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  // accessToken is read only to validate the fixture and must not be written to the manifest.
  process.stdout.write(`${JSON.stringify(buildPerformanceFixture(accounts), null, 2)}\n`);
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
