# WindNote k6 并发与容量测试

负载层直接复现 App 使用的 Socket.IO `/chat-ws` 协议和 REST `/api/v1` 路径。账号数据通过 k6 `SharedArray` 加载，token 只进入握手/header，不输出到摘要或报告。

## 场景

- `chat-send`：多个 VU 各自在一组会话中持续发文本，测 `chat:send` ack p95、失败率和 `chat:msg` 端到端送达。
- `chat-fan-in`：多个发送账号同时向一个在线 receiver 汇聚消息，测接收侧端到端延迟；`LOAD_TARGET_ALIAS` 指向 receiver。
- `circle-join`：多个账号并发 POST `/circle/:id/join`，成功后 DELETE `/leave` 清理，只能使用执行前未加入的专用圈子。
- `inbox-seed`：跨最多 1,000 个已配置会话灌入每会话最多 200 条文本，用于随后测 App 大列表/深历史 UI；额外要求 `LOAD_PERFORMANCE_FIXTURE=true`。

## 安全与账号文件

复制 `data/accounts.example.json` 为被忽略的 `data/accounts.local.json`。每项格式：

```json
{
  "alias": "sender-01",
  "accessToken": "dedicated-staging-token",
  "conversationIds": ["seeded-conversation-id"],
  "circleIds": ["safe-not-yet-joined-circle-id"]
}
```

运行器同时要求 `LOAD_EXECUTE=true`、`LOAD_ALLOW_MUTATION=true`、安全 run ID、HTTPS/WSS allowlist、同一 API/socket host，并显式拒绝生产 WindNote 主机。`circle-join` 强制 `LOAD_CIRCLE_CLEANUP=true`。

### 「生产」是怎么认出来的

allowlist 由调用方自己提供，和目标同源，所以它拦不住「把生产填进自己的
allowlist」这种误操作 —— 真正兜底的是生产主机判定。而这个仓库里**没有**生产
域名：app 的端点是构建期由 `vars.EXPO_PUBLIC_API_URL` 注入的。因此判定不依赖
一张手写清单，而是取三个来源的并集（见 `load-tests/lib/production-hosts.js`）：

| 来源 | 说明 |
| --- | --- |
| 内置已知域名 | 只当下限，只增不减 |
| `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_REALTIME_WS_URL` | app 自己的构建变量，环境里有就自动生效，零配置且不会漂移 |
| `LOAD_PRODUCTION_HOSTS` / `E2E_PRODUCTION_HOSTS` | 显式补充，逗号分隔，接受 URL 或裸域名 |

**CI 应当从与构建同一个 `vars.EXPO_PUBLIC_API_URL` 把值喂进来**，让这道闸和真实
部署同源。生产换域名、加区域域名时，防护跟着变，不需要有人记得回来改清单。

## 逐级 ramp

先在 1 VU/30 秒验证 fixture，再逐级扩到 10、50、100；每级观察后端 CPU/内存、数据库连接池、Socket 连接数、429/5xx 和队列积压，不要一次跳到目标峰值。

```sh
npm run load:chat-send
npm run load:chat-fan-in
npm run load:circle-join
npm run load:inbox-seed
```

典型环境变量：

```text
LOAD_VUS=10
LOAD_DURATION_SECONDS=60
LOAD_MESSAGES_PER_CONVERSATION=20
LOAD_CONVERSATIONS=500
```

默认阈值：ack `p(95)<1500ms`、delivery `p(95)<2500ms`、发送/HTTP 失败率 `<2%`、checks `>98%`。Inbox seed 使用 ack 2 秒、delivery 3.5 秒、失败率 1%。这些是第一版回归线，首次真机/测试环境执行后应按稳定基线收紧，而不是为通过一次测试而放宽。

## 结果解释

k6 验证的是服务端与实时链路容量，不代表手机 UI 流畅。正确顺序是先运行负载/seed 构造大量会话和消息，再在同一测试账号上执行 `npm run perf:android` 或 `npm run perf:ios`，把后端延迟与客户端帧、内存和 hitch trace 对齐分析。
