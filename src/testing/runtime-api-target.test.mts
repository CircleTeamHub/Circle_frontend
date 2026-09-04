import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRuntimeApiTargetId } from './runtime-api-target.ts';
// 同一编码在 E2E runner 里有一份 Node 副本（Metro 与 Node 各自的模块图不好共享）。
// 下面的 parity 测试钉住两份实现逐字节一致；改任何一份都会在这里炸。
import { buildRuntimeApiTargetId as buildRunnerTargetId } from '../../scripts/testing/safe-test-config.mjs';

test('runtime API target ids are canonical and regex-safe', () => {
  assert.equal(
    buildRuntimeApiTargetId('https://E2E-API.windnote.test/api/v1'),
    'windnote_runtime_api_origin_00680074007400700073003a002f002f006500320065002d006100700069002e00770069006e0064006e006f00740065002e0074006500730074',
  );
  assert.match(buildRuntimeApiTargetId('https://e2e-api.windnote.test'), /^[a-z0-9_]+$/);
});

test('the app and the E2E runner encode runtime targets identically', () => {
  const inputs = [
    'http://localhost:3000/api/v1',
    'http://10.0.2.2:3000',
    'https://E2E-API.windnote.test/api/v1',
    'https://Api.Example.COM/',
    'https://api.example.com:443/api/v1',
    'http://api.example.com:80/api/v1',
    'https://api.example.com:8443/api/v1///',
    'https://staging.example.com/api/v1?debug=1#frag',
    'https://[::1]:3000/api/v1',
    'https://[2001:DB8::1]/api/v1',
    'http://xn--fsq.example/api/v1',
  ];
  for (const input of inputs) {
    const appId = buildRuntimeApiTargetId(input);
    assert.equal(buildRunnerTargetId(input), appId, input);
    assert.match(appId, /^windnote_runtime_api_origin_[0-9a-f]+$/, input);
  }
  // 大小写、路径、query、默认端口都折叠进同一个 origin —— 两边一致地折叠。
  assert.equal(
    buildRuntimeApiTargetId('https://Api.Example.COM:443/x?y#z'),
    buildRunnerTargetId('https://api.example.com/api/v1'),
  );
});
