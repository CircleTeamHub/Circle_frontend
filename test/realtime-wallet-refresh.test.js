const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// wallet.balance.changed 会把客户端推去拉一次权威余额。这条路径上有两个坑，
// 两个都只在「请求还在飞」的那段窗口里出现，所以只能用可控的 deferred 来测：
//   1. 换号之后落地的响应会写进全局钱包 store —— 上一个账号的余额显示给下一个人；
//   2. 单飞期间来的第二次事件被整个丢掉 —— 第一发的快照若早于第二次结算，
//      余额就停在旧值，直到下一次事件或手动刷新。
function loadHarness() {
  const filePath = path.join(process.cwd(), "src/realtime/client.ts");
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const sessionEpoch = { value: 0 };
  const timers = [];
  const walletWrites = [];
  const walletCalls = [];
  const sockets = [];

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      sockets.push(this);
    }
    send(data) {
      this.sent.push(data);
    }
    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  const stubStore = (state) => {
    const store = () => state;
    store.getState = () => state;
    store.setState = () => {};
    store.subscribe = () => () => {};
    return store;
  };
  const noopStore = () =>
    stubStore(
      new Proxy(
        {},
        {
          get: () => () => {},
        },
      ),
    );

  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
    WebSocket: FakeWebSocket,
    require: (request) => {
      switch (request) {
        case "@/constants/config":
          return { REALTIME_WS_URL: "wss://example.test/chat-ws" };
        case "@/observability/sentry":
          return { reportError: () => {} };
        case "@/services/api/coin":
          return {
            fetchWallet: () => {
              // 每次调用交出一个可以由测试决定何时兑现的 deferred。
              let resolve;
              const promise = new Promise((r) => {
                resolve = r;
              });
              walletCalls.push({ resolve });
              return promise;
            },
          };
        case "@/services/api/plaza":
          return { fetchMySignupsUnreadCount: async () => 0 };
        case "@/services/api/friends":
          return { fetchUnreadFriendActivityCount: async () => 0 };
        case "@/services/api/auth":
          return { fetchCurrentUser: async () => null };
        case "@/services/auth/session":
          return {
            registerLogoutHandler: () => () => {},
            clearLocalSession: async () => {},
          };
        case "@/stores/authStore": {
          // sessionEpoch 只在登录/登出时自增,token 轮换不动 —— 围栏按它判。
          const state = {
            get sessionEpoch() {
              return sessionEpoch.value;
            },
            setUser: () => {},
          };
          return { useAuthStore: stubStore(state) };
        }
        case "@/stores/walletRealtimeStore":
          return {
            useWalletRealtimeStore: stubStore({
              setRealtimeBalance: (balance) => walletWrites.push(balance),
            }),
          };
        default:
          // 展开 Proxy 只会拷到自有可枚举属性(没有),必须原样返回。
          return fallbackStubs();
      }
    },
  };

  function fallbackStubs() {
    // 其余模块一律给一个「任何具名导出都是空函数 / 空 store」的替身。
    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "__esModule") return true;
          if (typeof prop === "string" && prop.startsWith("use")) {
            return noopStore();
          }
          return () => false;
        },
        has: () => true,
      },
    );
  }

  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  return {
    ...context.module.exports,
    walletWrites,
    walletCalls,
    // 触发挂起的重连定时器(harness 的 setTimeout 只记不跑)。
    runPendingReconnect() {
      const fn = timers.shift();
      if (!fn) throw new Error("no reconnect timer scheduled");
      fn();
    },
    // 换号 = sessionEpoch 前进;token 轮换不动它。
    switchAccount() {
      sessionEpoch.value += 1;
    },
    sockets,
    flush,
    // 直接投递一条余额变更帧，等价于服务端 poke。
    pokeBalance(socket) {
      socket.onmessage({
        data: JSON.stringify({ type: "wallet.balance.changed", data: {} }),
      });
    },
    openLatest() {
      const socket = sockets[sockets.length - 1];
      socket.readyState = FakeWebSocket.OPEN;
      socket.onopen?.();
      return socket;
    },
    // 收到第一帧 = 网关认证通过。补拉全部挂在它后面（握手成功还可能被 1008 拒）。
    authenticate(socket) {
      socket.onmessage({ data: JSON.stringify({ type: 'noop' }) });
      return socket;
    },
    openAndAuthenticateLatest() {
      const socket = sockets[sockets.length - 1];
      socket.readyState = FakeWebSocket.OPEN;
      socket.onopen?.();
      socket.onmessage({ data: JSON.stringify({ type: 'noop' }) });
      return socket;
    },
  };
}

test("换号之后落地的余额响应不会写进新账号的钱包", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  const socketA = harness.openLatest();

  harness.pokeBalance(socketA);
  assert.equal(harness.walletCalls.length, 1, "poke 应该发起一次余额请求");

  // A 的请求还在飞，用户登出并换成 B。
  harness.disconnectRealtime();
  harness.switchAccount();
  harness.connectRealtime("token-b");

  // 此时 A 的响应才落地。
  harness.walletCalls[0].resolve({ balance: 8888 });
  await harness.flush();

  assert.deepEqual(
    harness.walletWrites,
    [],
    "A 账号的余额不能写进换号之后的全局钱包 store",
  );
});

test("单飞期间来的第二次余额事件会补一次尾随请求", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  const socket = harness.openLatest();

  harness.pokeBalance(socket);
  assert.equal(harness.walletCalls.length, 1);

  // 第一发还在飞的时候又结算了一笔。
  harness.pokeBalance(socket);
  assert.equal(harness.walletCalls.length, 1, "单飞：不应该并发第二个请求");

  // 第一发返回的是第二次结算之前的快照。
  harness.walletCalls[0].resolve({ balance: 100 });
  await harness.flush();

  assert.equal(
    harness.walletCalls.length,
    2,
    "第二次 poke 不能被丢掉，落地后要补一次权威读",
  );

  harness.walletCalls[1].resolve({ balance: 120 });
  await harness.flush();

  assert.deepEqual(
    harness.walletWrites,
    [100, 120],
    "最终余额必须是尾随请求读到的那个",
  );
});

test("没有后续事件时不会无限尾随", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  const socket = harness.openLatest();

  harness.pokeBalance(socket);
  harness.walletCalls[0].resolve({ balance: 10 });
  await harness.flush();

  assert.equal(harness.walletCalls.length, 1);
  assert.deepEqual(harness.walletWrites, [10]);
});

// 例行的令牌刷新是同一个人、同一段会话：SessionBootstrap 会 disconnect + 用新
// token 重连，但 authStore.sessionEpoch 不动。按 token 判的话，这次刷新会把在途
// 的余额请求判成过期丢掉且不补发——而当前契约的 wallet.balance.changed 不带绝对
// 余额，丢了就只能等下一次事件，余额一直是旧的。
test("token 轮换不作废在途的余额请求", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  const socket = harness.openLatest();

  harness.pokeBalance(socket);
  assert.equal(harness.walletCalls.length, 1);

  // 同一段会话内换 token（sessionEpoch 不动）。
  harness.disconnectRealtime();
  harness.connectRealtime("token-a2");

  harness.walletCalls[0].resolve({ balance: 777 });
  await harness.flush();

  assert.deepEqual(
    harness.walletWrites,
    [777],
    "同一段会话的响应必须照常写进钱包",
  );
});

// 断线空窗里结算的奖励/充值，那一帧是彻底丢掉的。badge 和朋友圈都在重连时补，
// 钱包不补的话，一个全程挂着的钱包页会一直显示断线前的余额。
test("重连恢复会补一次钱包对账", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  const first = harness.openLatest();
  first.readyState = 3;
  // 掉线 → 触发重连（recoveryPending）。
  first.onclose?.({ code: 1006 });
  harness.runPendingReconnect?.();

  const before = harness.walletCalls.length;
  // 定时器触发后会开一个新 socket；补拉在收到第一帧（= 认证通过）之后才跑。
  harness.openAndAuthenticateLatest();

  assert.ok(
    harness.walletCalls.length > before,
    "重连成功后应该补一次权威余额读",
  );
});

// token 轮换会把单飞格子清空，但在途那一发按 sessionEpoch 判并不过期（故意的，
// 见上一条）。于是同一段会话里可能有两发同时在途；乱序返回时，先发后到的那发
// 拿的是更旧的快照，写进去就把新余额盖回去了，而且要等下一次事件才纠正。
test("跨 token 轮换的两发请求乱序返回时，旧快照不能覆盖新余额", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  const socketA = harness.openLatest();

  harness.pokeBalance(socketA);
  assert.equal(harness.walletCalls.length, 1);

  // 同一段会话内换 token：单飞格子被清空，第一发还在飞。
  harness.disconnectRealtime();
  harness.connectRealtime("token-a2");
  const socketB = harness.openLatest();

  harness.pokeBalance(socketB);
  assert.equal(
    harness.walletCalls.length,
    2,
    "轮换清空了单飞格子，新事件会另起一发",
  );

  // 新的先回、旧的后回。
  harness.walletCalls[1].resolve({ balance: 200 });
  await harness.flush();
  harness.walletCalls[0].resolve({ balance: 100 });
  await harness.flush();

  assert.deepEqual(
    harness.walletWrites,
    [200],
    "只有最新的那一发允许写钱包 store",
  );
});

// 旧的那一发落地时不能把新一发的单飞格子清掉——否则单飞失效，后续每个事件都
// 会并发出一个新请求。
test("旧的那一发落地不会清掉新一发的单飞格子", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  const socketA = harness.openLatest();

  harness.pokeBalance(socketA);
  harness.disconnectRealtime();
  harness.connectRealtime("token-a2");
  const socketB = harness.openLatest();
  harness.pokeBalance(socketB);
  assert.equal(harness.walletCalls.length, 2);

  // 旧的先落地：它既不能写 store，也不能腾出格子。
  harness.walletCalls[0].resolve({ balance: 100 });
  await harness.flush();
  assert.deepEqual(harness.walletWrites, [], "旧快照不写 store");

  harness.pokeBalance(socketB);
  assert.equal(
    harness.walletCalls.length,
    2,
    "新一发还在飞，第三个事件应该记脏而不是并发新请求",
  );

  harness.walletCalls[1].resolve({ balance: 200 });
  await harness.flush();
  assert.equal(harness.walletCalls.length, 3, "记脏的那次要补一发尾随请求");
  harness.walletCalls[2].resolve({ balance: 220 });
  await harness.flush();
  assert.deepEqual(harness.walletWrites, [200, 220]);
});

// 单飞窗口里的第二次 poke 只记了个「脏」。如果这时 token 轮换,disconnectRealtime
// 把脏标记也清掉,第一发就会带着更旧的快照落地,而且没有尾随请求来纠正 ——
// wallet.balance.changed 不带绝对余额,只能一直错到下一次事件。
test("跨 token 轮换不会丢掉单飞窗口里记下的第二次结算", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  const socket = harness.openLatest();

  harness.pokeBalance(socket);
  assert.equal(harness.walletCalls.length, 1);
  // 第一发还在飞的时候又结算了一笔 → 记脏。
  harness.pokeBalance(socket);
  assert.equal(harness.walletCalls.length, 1, "单飞：不并发第二个请求");

  // 脏标记还没兑现，token 就轮换了（同一段会话，sessionEpoch 不动）。
  harness.disconnectRealtime();
  harness.connectRealtime("token-a2");

  // 第一发这才落地，拿的是第二次结算之前的快照。
  harness.walletCalls[0].resolve({ balance: 100 });
  await harness.flush();

  assert.equal(
    harness.walletCalls.length,
    2,
    "记脏的那次必须在轮换之后仍然补一发",
  );
  harness.walletCalls[1].resolve({ balance: 160 });
  await harness.flush();
  assert.deepEqual(harness.walletWrites, [100, 160], "最终必须落在新余额上");
});

// 换号则相反：脏标记属于上一个账号，不能给新账号补一次读。
test("换号之后不会替新账号兑现上一个账号的脏标记", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  const socket = harness.openLatest();

  harness.pokeBalance(socket);
  harness.pokeBalance(socket);
  assert.equal(harness.walletCalls.length, 1);

  harness.disconnectRealtime();
  harness.switchAccount();
  harness.connectRealtime("token-b");

  harness.walletCalls[0].resolve({ balance: 100 });
  await harness.flush();

  assert.equal(harness.walletCalls.length, 1, "不给新账号补读");
  assert.deepEqual(harness.walletWrites, [], "上个账号的余额也不写进去");
});

// 回到前台 / 令牌轮换会直接调 connectRealtime，它先把退避定时器取消掉，退避回调
// 根本不会执行。断线标记要是留在回调里，这条路径就完全跳过了断线期间的补拉。
test("显式重连抢在退避回调之前，仍然会补一次对账", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  harness.openAndAuthenticateLatest();

  const before = harness.walletCalls.length;
  const first = harness.sockets[harness.sockets.length - 1];
  first.readyState = 3;
  first.onclose?.({ code: 1006 });

  // 退避定时器还挂着，用户切回前台 → 显式重连，取消掉那个定时器。
  harness.connectRealtime("token-a");
  harness.openAndAuthenticateLatest();

  assert.equal(
    harness.walletCalls.length,
    before + 1,
    "断线后的第一次成功连接必须补一次权威余额读",
  );
});

// 网关接受握手之后仍然可能以 1008 拒掉认证（会话撤销 / 连接数超限）。补拉挂在
// onopen 上的话，实时通道根本没恢复也会照发，而每一轮退避再来一次 —— 一次网关
// 故障被放大成所有客户端的轮询。
test("握手成功但认证被拒时不会发出补拉请求", async () => {
  const harness = loadHarness();
  harness.connectRealtime("token-a");
  harness.openAndAuthenticateLatest();
  const before = harness.walletCalls.length;

  for (let round = 0; round < 3; round += 1) {
    const socket = harness.sockets[harness.sockets.length - 1];
    socket.readyState = 3;
    socket.onclose?.({ code: 1006 });
    harness.runPendingReconnect();
    // 只握手、不给帧 = 网关随后以 1008 拒掉。
    harness.openLatest();
  }

  assert.equal(
    harness.walletCalls.length,
    before,
    "没有认证过的连接不该触发任何钱包请求",
  );

  // 真正认证通过的那一次，补拉只跑一次。
  harness.authenticate(harness.sockets[harness.sockets.length - 1]);
  assert.equal(harness.walletCalls.length, before + 1);
});
