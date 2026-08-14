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
    setTimeout: () => 1,
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
