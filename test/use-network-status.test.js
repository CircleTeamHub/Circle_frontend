const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('network status probes an existing API route instead of the /api/v1 root', () => {
  const source = read('src/hooks/use-network-status.ts');

  assert.match(source, /const NETWORK_PROBE_URL = `\$\{API_URL\}\/auth\/me`/);
  assert.match(source, /fetch\(NETWORK_PROBE_URL/);
  assert.doesNotMatch(source, /fetch\(API_URL/);
});
