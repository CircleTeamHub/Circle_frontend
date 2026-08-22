import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlace } from './reverse-geocode.ts';

const GEOCODER_BASE_URL = 'https://geocoder.example.test';

type FetchStub = {
  calls: string[];
  restore: () => void;
};

function stubFetch(
  handler: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
): FetchStub {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const ok = (body: unknown) => ({ ok: true, json: async () => body });

test('a resolved place is cached so the same pin never asks twice', async () => {
  const stub = stubFetch(async () =>
    ok({ name: '民田路', display_name: '民田路, 福田区, 深圳市, 中国' }),
  );
  try {
    const first = await resolvePlace(22.54001, 114.05001, GEOCODER_BASE_URL);
    const second = await resolvePlace(22.54001, 114.05001, GEOCODER_BASE_URL);

    assert.deepEqual(first, {
      title: '民田路',
      address: '民田路, 福田区, 深圳市, 中国',
    });
    assert.deepEqual(second, first);
    assert.equal(stub.calls.length, 1, '第二次必须命中缓存');
  } finally {
    stub.restore();
  }
});

test('concurrent lookups for one pin share a single request', async () => {
  const stub = stubFetch(async () =>
    ok({ name: 'Cupertino', display_name: 'Cupertino, CA, USA' }),
  );
  try {
    const [a, b, c] = await Promise.all([
      resolvePlace(37.32002, -122.03002, GEOCODER_BASE_URL),
      resolvePlace(37.32002, -122.03002, GEOCODER_BASE_URL),
      resolvePlace(37.32002, -122.03002, GEOCODER_BASE_URL),
    ]);

    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
    assert.equal(stub.calls.length, 1, '并发只应发一次请求');
  } finally {
    stub.restore();
  }
});

// 失败缓存住就等于「这个点永远显示经纬度」——网络恢复后必须还能再试。
test('a failed lookup is not cached and retries on the next reveal', async () => {
  let attempt = 0;
  const stub = stubFetch(async () => {
    attempt += 1;
    if (attempt === 1) return { ok: false, json: async () => ({}) };
    return ok({ name: '西湖', display_name: '西湖, 杭州市, 中国' });
  });
  try {
    assert.equal(await resolvePlace(30.24003, 120.15003, GEOCODER_BASE_URL), null);
    assert.deepEqual(await resolvePlace(30.24003, 120.15003, GEOCODER_BASE_URL), {
      title: '西湖',
      address: '西湖, 杭州市, 中国',
    });
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('a response without any usable name resolves to null', async () => {
  const stub = stubFetch(async () => ok({ error: 'Unable to geocode' }));
  try {
    assert.equal(await resolvePlace(0.00004, 0.00004, GEOCODER_BASE_URL), null);
  } finally {
    stub.restore();
  }
});

// display_name 打头的那一段就是最具体的地名，name 缺失时用它当标题。
test('the leading segment of display_name becomes the title when name is absent', async () => {
  const stub = stubFetch(async () =>
    ok({ display_name: '  金田路 , 福中社区, 深圳市' }),
  );
  try {
    assert.deepEqual(await resolvePlace(22.53005, 114.04005, GEOCODER_BASE_URL), {
      title: '金田路',
      address: '金田路 , 福中社区, 深圳市',
    });
  } finally {
    stub.restore();
  }
});

// nominatim 的使用条款不接受并发轰炸：一屏多条位置消息必须排队，不能同时打出去。
test('lookups for different pins are serialized, never overlapping', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const stub = stubFetch(async (url) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return ok({ name: url.slice(-6), display_name: 'somewhere' });
  });
  try {
    await Promise.all([
      resolvePlace(1.00006, 1.00006, GEOCODER_BASE_URL),
      resolvePlace(2.00006, 2.00006, GEOCODER_BASE_URL),
      resolvePlace(3.00006, 3.00006, GEOCODER_BASE_URL),
    ]);

    assert.equal(maxInFlight, 1, '反查必须串行');
    assert.equal(stub.calls.length, 3);
  } finally {
    stub.restore();
  }
});

test('out-of-range coordinates never reach the network', async () => {
  const stub = stubFetch(async () => ok({ name: 'nope', display_name: 'nope' }));
  try {
    assert.equal(await resolvePlace(91, 0, GEOCODER_BASE_URL), null);
    assert.equal(await resolvePlace(0, 181, GEOCODER_BASE_URL), null);
    assert.equal(await resolvePlace(Number.NaN, 0, GEOCODER_BASE_URL), null);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('no provider configured means no public geocoder request', async () => {
  const stub = stubFetch(async () => ok({ name: 'unexpected' }));
  try {
    assert.equal(await resolvePlace(22.5, 114.0, null), null);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
