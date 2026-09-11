const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// 圈子通知三档的 store：历史形状迁移、总闸与子档的与运算、未读红点门控、
// 登出重置。全部是纯函数/纯 store 行为，不碰网络（同步那一半在
// src/features/discover/hooks/use-circle-notification-tiers.spec.tsx）。

// loadTsModule 在独立 VM context 里跑，那边造出来的对象带的是另一套
// Object.prototype，assert.deepEqual（strict）会因此判不等。摊平成本 realm 的
// 普通对象再比 —— 不能用 JSON round-trip，那会把 `circleUnread: undefined`
// 这类「这一帧没带这个数」的语义抹掉。
const plain = (value) => ({ ...value });

function loadStore() {
  const backing = new Map();
  const shims = {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/storage': {
      mmkvJsonStorage: {
        getItem: (key) => backing.get(key) ?? null,
        setItem: (key, value) => backing.set(key, value),
        removeItem: (key) => backing.delete(key),
      },
    },
  };
  return loadTsModule(
    'src/features/discover/store/use-circle-notification-store.ts',
    {
      requireShim: (specifier) => {
        if (shims[specifier]) return shims[specifier];
        throw new Error(`unexpected import: ${specifier}`);
      },
    },
  );
}

test('v1 的 inAppEnabled 迁到总闸，bannerEnabled 留在横幅那一格', () => {
  const { migrateCircleNotificationState } = loadStore();

  // 关键回归：v1 的「只关横幅」不能被折成「全关」—— 那会顺手关掉红点和离线推送，
  // 用户从没要求过那两件事。
  assert.deepEqual(
    plain(
      migrateCircleNotificationState({
        inAppEnabled: true,
        bannerEnabled: false,
      }),
    ),
    {
      globalEnabled: true,
      bannerEnabled: false,
      soundEnabled: true,
      offlineEnabled: true,
    },
  );

  // v1 关掉总闸：总闸归总闸。
  assert.deepEqual(
    plain(
      migrateCircleNotificationState({
        inAppEnabled: false,
        bannerEnabled: true,
      }),
    ),
    {
      globalEnabled: false,
      bannerEnabled: true,
      soundEnabled: true,
      offlineEnabled: true,
    },
  );
});

test('v0 / 半截形状 / 垃圾值都落到安全默认', () => {
  const { migrateCircleNotificationState } = loadStore();

  // v0 只有 globalEnabled。
  assert.deepEqual(plain(migrateCircleNotificationState({ globalEnabled: false })), {
    globalEnabled: false,
    bannerEnabled: true,
    soundEnabled: true,
    offlineEnabled: true,
  });

  // 中途那一版只留了 bannerEnabled。
  assert.deepEqual(plain(migrateCircleNotificationState({ bannerEnabled: false })), {
    globalEnabled: true,
    bannerEnabled: false,
    soundEnabled: true,
    offlineEnabled: true,
  });

  // 空 / null / 非布尔垃圾：全部默认打开，而不是把人的通知静默关掉。
  const allOn = {
    globalEnabled: true,
    bannerEnabled: true,
    soundEnabled: true,
    offlineEnabled: true,
  };
  for (const persisted of [
    undefined,
    null,
    {},
    { globalEnabled: 'false', offlineEnabled: 0 },
  ]) {
    assert.deepEqual(plain(migrateCircleNotificationState(persisted)), allOn);
  }
});

test('迁移是纯函数：不发请求、当前形状原样保留', () => {
  const { migrateCircleNotificationState } = loadStore();

  const current = {
    globalEnabled: false,
    bannerEnabled: false,
    soundEnabled: false,
    offlineEnabled: false,
  };
  assert.deepEqual(plain(migrateCircleNotificationState(current)), current);

  // 迁移里出现任何网络调用，都意味着冷启动会拿一个「推导出来的」值去覆盖
  // 服务端的真值。源码层面钉住这一点。
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/discover/store/use-circle-notification-store.ts',
    ),
    'utf8',
  );
  assert.doesNotMatch(source, /updateCircleOfflinePushEnabled|apiClient|fetch\(/);
});

test('子档的生效值一律与总闸相与', () => {
  const {
    circleBannerAllowed,
    circleSoundAllowed,
    circleBadgeAllowed,
    circleOfflinePushAllowed,
  } = loadStore();

  const off = {
    globalEnabled: false,
    bannerEnabled: true,
    soundEnabled: true,
    offlineEnabled: true,
  };
  assert.equal(circleBannerAllowed(off), false);
  assert.equal(circleSoundAllowed(off), false);
  assert.equal(circleBadgeAllowed(off), false);
  assert.equal(circleOfflinePushAllowed(off), false);

  const on = { ...off, globalEnabled: true };
  assert.equal(circleBannerAllowed(on), true);
  assert.equal(circleSoundAllowed(on), true);
  assert.equal(circleBadgeAllowed(on), true);
  assert.equal(circleOfflinePushAllowed(on), true);

  // 历史用户关过的横幅仍然生效，且只影响横幅。
  const bannerOff = { ...on, bannerEnabled: false };
  assert.equal(circleBannerAllowed(bannerOff), false);
  assert.equal(circleBadgeAllowed(bannerOff), true);
  assert.equal(circleOfflinePushAllowed(bannerOff), true);
});

test('总闸关掉时圈子未读从展示里摘掉，互动总数也扣掉那一份', () => {
  const { gateCircleUnread } = loadStore();
  const off = {
    globalEnabled: false,
    bannerEnabled: true,
    soundEnabled: true,
    offlineEnabled: true,
  };
  const on = { ...off, globalEnabled: true };

  // 开着：原样放行。
  assert.deepEqual(
    plain(gateCircleUnread({ discoverUnread: 7, circleUnread: 3 }, on)),
    { discoverUnread: 7, circleUnread: 3 },
  );

  // 关掉：圈子归零，总数扣掉圈子那一份（朋友圈 / 好友申请的未读不受牵连）。
  assert.deepEqual(
    plain(gateCircleUnread({ discoverUnread: 7, circleUnread: 3 }, off)),
    { discoverUnread: 4, circleUnread: 0 },
  );

  // 扣不成负数：老快照里两个数字对不上时也不能出现负徽标。
  assert.deepEqual(
    plain(gateCircleUnread({ discoverUnread: 1, circleUnread: 3 }, off)),
    { discoverUnread: 0, circleUnread: 0 },
  );

  // 老后端不带 circleUnread：扣不出圈子那一份，总数只能原样放行（而不是清零，
  // 否则每来一条互动通知都会把朋友圈红点抹掉）。
  assert.deepEqual(plain(gateCircleUnread({ discoverUnread: 5 }, off)), {
    discoverUnread: 5,
    circleUnread: undefined,
  });

  // 字段缺失 = 「这一帧没带这个数」，不能被门控写成 0 覆盖掉既有值。
  assert.deepEqual(plain(gateCircleUnread({ circleUnread: 2 }, off)), {
    discoverUnread: undefined,
    circleUnread: 0,
  });
});

test('登出把三档清回默认：offlineEnabled 镜像的是 per-user 字段，不能跨号残留', () => {
  const { useCircleNotificationStore } = loadStore();

  useCircleNotificationStore.setState({
    globalEnabled: false,
    bannerEnabled: false,
    soundEnabled: false,
    offlineEnabled: false,
  });
  useCircleNotificationStore.getState().resetForLogout();

  const { globalEnabled, bannerEnabled, soundEnabled, offlineEnabled } =
    useCircleNotificationStore.getState();
  assert.deepEqual(
    { globalEnabled, bannerEnabled, soundEnabled, offlineEnabled },
    {
      globalEnabled: true,
      bannerEnabled: true,
      soundEnabled: true,
      offlineEnabled: true,
    },
  );
});
