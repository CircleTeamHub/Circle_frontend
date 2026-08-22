import { check, sleep } from 'k6';
import http from 'k6/http';
import { parseRuntimeConfig } from '../lib/config.js';
import { loadAccounts } from '../lib/k6-data.js';
import { selectAccount } from '../lib/data.js';
import { joinFailed, joinLatencyMs } from '../lib/metrics.js';

const config = parseRuntimeConfig(__ENV);
const accounts = loadAccounts(__ENV.LOAD_ACCOUNTS_FILE);
if (__ENV.LOAD_CIRCLE_CLEANUP !== 'true') {
  throw new Error('LOAD_CIRCLE_CLEANUP=true is required to keep fixtures reusable.');
}

export const options = {
  scenarios: {
    parallel_circle_joins: {
      executor: 'per-vu-iterations',
      vus: config.vus,
      iterations: 1,
      maxDuration: `${config.durationSeconds + 30}s`,
    },
  },
  thresholds: {
    join_latency_ms: ['p(95)<2000'],
    join_failed: ['rate<0.02'],
    http_req_failed: ['rate<0.02'],
    checks: ['rate>0.98'],
  },
};

function request(account, method, path, tags) {
  return http.request(method, `${config.apiBaseUrl}${path}`, null, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
    tags,
    timeout: '15s',
  });
}

export default function () {
  const account = selectAccount(accounts, __VU);
  if (account.circleIds.length === 0) throw new Error(`${account.alias} has no circleIds.`);
  for (const circleId of account.circleIds) {
    const joined = request(account, 'POST', `/circle/${circleId}/join`, { operation: 'join' });
    const ok = check(joined, { 'circle join accepted': (response) => response.status >= 200 && response.status < 300 });
    joinFailed.add(!ok);
    joinLatencyMs.add(joined.timings.duration);
    sleep(0.2);
    if (ok) {
      const left = request(account, 'DELETE', `/circle/${circleId}/leave`, { operation: 'cleanup' });
      check(left, { 'test membership cleaned up': (response) => response.status >= 200 && response.status < 300 });
    }
  }
}
