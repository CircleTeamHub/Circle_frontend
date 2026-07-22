const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// FE#89：朋友圈新帖检测从 30s 轮询改为服务端广播（moments.feed.updated）驱动。
// 源码断言钉住三处契约：realtime client 分发、feed 组件订阅、轮询已删除。

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('realtime client dispatches moments.feed.updated into the signal store', () => {
  const source = read('src/realtime/client.ts');

  assert.match(source, /type: 'moments\.feed\.updated'/);
  assert.match(source, /case 'moments\.feed\.updated':/);
  assert.match(
    source,
    /useMomentsFeedSignalStore\.getState\(\)\.bump\(\)/,
    'client 必须把 poke 转成信号 store 的 bump',
  );
});

test('reconnect recovery bumps the signal to cover missed broadcasts (review P2)', () => {
  const source = read('src/realtime/client.ts');
  assert.match(
    source,
    /if \(shouldForceRecovery\) \{\s*useMomentsFeedSignalStore\.getState\(\)\.bump\(\);/,
    '重连成功后必须补 bump，一直前台的断连空窗才有兜底',
  );
});

test('signal only advances after a successful count fetch, with one bounded retry (review P2)', () => {
  const source = read('src/features/discover/components/moments-feed.tsx');

  // 成功才推进 handled；失败 15s 重试一次，不退化回轮询
  assert.match(source, /Promise<boolean>/);
  assert.match(source, /if \(ok\) \{\s*handledSignalRef\.current = feedSignalVersion;/);
  assert.match(source, /setTimeout\(run, 15_000\)/);
  assert.match(source, /if \(!retried\)/);
});

test('signal store is a plain in-memory monotonic counter', () => {
  const source = read(
    'src/features/discover/store/use-moments-feed-signal-store.ts',
  );

  assert.match(source, /version: state\.version \+ 1/);
  assert.doesNotMatch(
    source,
    /persist\(/,
    '信号是瞬态的，不允许持久化',
  );
});

test('moments feed subscribes to the broadcast signal instead of polling', () => {
  const source = read('src/features/discover/components/moments-feed.tsx');

  assert.match(source, /useMomentsFeedSignalStore/);
  assert.doesNotMatch(
    source,
    /setInterval/,
    '30s 轮询必须移除（#89 的整个目的）',
  );
  // 去抖合并突发 + 回前台兜底补查两条路径都在
  assert.match(source, /setTimeout\(run, 800\)/);
  assert.match(source, /AppState\.addEventListener\('change'/);
  assert.match(source, /fetchNewMomentsCount\(lastRefreshTime\)/);
});

test('backend pairing: event name matches circle_be REALTIME_EVENT_TYPES when sibling checkout exists', (t) => {
  const bePath = path.join(
    process.cwd(),
    '..',
    'circle_be',
    'src',
    'realtime',
    'realtime.service.ts',
  );
  if (!fs.existsSync(bePath)) {
    t.skip('sibling circle_be checkout not present');
    return;
  }
  const beSource = fs.readFileSync(bePath, 'utf8');
  if (!beSource.includes('broadcastMomentsFeedUpdated')) {
    // 隔壁 checkout 可能停在不含该特性的分支（比如另一个会话的工作分支）——
    // 无法区分「配对错」与「分支不同」，跳过；真正的配对由 BE 侧 spec 钉住。
    t.skip('sibling circle_be checkout is on a branch without the poke feature');
    return;
  }
  assert.match(
    beSource,
    /'moments\.feed\.updated'/,
    'BE 有 broadcastMomentsFeedUpdated 却没把事件挂进 REALTIME_EVENT_TYPES 允许清单',
  );
});
