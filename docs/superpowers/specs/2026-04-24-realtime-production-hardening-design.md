# Realtime WebSocket Production Hardening — End-to-End Design

**Status:** Draft
**Date:** 2026-04-24
**Owners:** Yibo
**Scope:** `circle_be/src/realtime/` (NestJS Gateway) + `circle-im/src/realtime/` (Expo client)
**Out of scope:** Chat / IM 消息（走 OpenIMSDK，不在本文档范围）

---

## 0. 背景与范围

### 0.1 这是什么

本文档定义 **业务事件 WebSocket 总线** 的产品级实施方案。该总线承载未读 badge、钱包、会员、好友/圈子活动、系统通知、用户档案变更等"业务事件"，**不承载聊天消息**。聊天消息走独立的 OpenIMSDK 通道（`circle-im/src/im/`），生命周期、协议、扩展性均不同，本文档不涉及。

### 0.2 为什么现在做

当前实现已经能跑通主要功能（见 `2026-04-24-tab-badge-realtime-design.md`），但缺少上线必备的稳定性、安全性、可观测性能力。生产环境会出现以下风险：

- 客户端断网后无法自动补齐遗漏事件 → 未读数长期失真
- 无 Origin / payload 限制 → 易被恶意客户端打挂
- 无消息级 ack / sequence → 网络抖动期间事件丢失无法察觉
- 无 metrics → 出问题盲查
- 配置硬编码 → 不能按环境调优
- 单实例内存状态 → 后端无法水平扩展

### 0.3 目标

| 目标 | 衡量标准 |
| --- | --- |
| 鉴权可信 | 未鉴权 / token 伪造 / token 过期均被拒；userId 仅来自 token |
| 心跳可靠 | 网络断开 ≤ 90s 内服务端释放连接，客户端 ≤ 60s 触发重连 |
| 消息可靠 | 客户端发送有 ack；服务端推送支持 ack + 离线补偿；重连后无遗漏 |
| 顺序正确 | 同一用户事件按 sequence 单调递增；缺口可检出并补齐 |
| 不易打挂 | 单连接消息频率 / payload 大小 / 单用户连接数 / 单 IP 连接数均有上限 |
| 可观测 | 当前在线连接数、msg/s、ack 成功率、鉴权失败、限流次数有 metrics |
| 配置化 | 心跳间隔、payload 上限、限流阈值等不在业务代码硬编码 |
| 可扩展 | 多实例部署不需要改业务代码；状态走 Redis |
| 有测试 | 鉴权失败、心跳超时、非法 JSON、超大 payload、限流、重复 requestId、断线补消息、踢下线均有测试 |

### 0.4 非目标

- 不做端到端加密（传输层 WSS 即可）
- 不做基于 WS 的 RPC 框架（业务请求仍走 HTTP/REST，WS 只承载事件 + 少量轻量 ack）
- 不替换 OpenIM
- 不在本期引入 Redis Streams / Kafka，**预留接口**即可，单实例 + Redis Pub/Sub 是本期目标

---

## 1. 当前 baseline 盘点

### 1.1 Backend `circle_be/src/realtime/`

```
realtime.gateway.ts       已有：JWT 校验、10s 鉴权超时、5/user 连接上限、30s ping/pong、exp 定时关闭、ws/WeakMap
realtime.service.ts       已有：in-memory Map<userId, Set<WebSocket>>、broadcast、emitSnapshot、各业务 broadcast*
realtime.module.ts        JwtModule 注册
```

**已有：** 单实例广播、JWT 校验、心跳、连接上限。
**缺：** Origin 校验、WSS 强制、payload 上限、消息级限流、协议 envelope、schema 校验、统一错误码、token 黑名单 / 主动踢下线、Redis Pub/Sub、Presence 抽象、metrics、结构化日志、配置外置、失败路径测试。

### 1.2 Frontend `circle-im/src/realtime/client.ts`

```
client.ts                 已有：URL token、exp backoff + jitter (max 10 次/30s)、onmessage 静默 JSON.parse
```

**已有：** 基础连接 + 重连。
**缺：** 消息层鉴权、心跳兜底、ack、requestId/messageId、sequence 缺口检测、断线补消息拉取、schema 校验、错误码处理、前后台切换、token 过期刷新、连接状态机、限流自我节流、可观测埋点。

### 1.3 已落地的相关 spec

- `docs/superpowers/specs/2026-04-24-tab-badge-realtime-design.md` — 定义"哪些业务事件走 realtime"。本文档与之**互补**：那是 Feature Spec，本文是 Infrastructure Spec。

---

## 2. 目标架构

### 2.1 系统拓扑

```
                                 ┌──────────────────────────┐
                                 │   Mobile / Web Client    │
                                 │ circle-im/src/realtime/  │
                                 │ ┌──────────────────────┐ │
                                 │ │ ConnectionManager FSM│ │
                                 │ │ Heartbeat            │ │
                                 │ │ MessageCodec (Zod)   │ │
                                 │ │ AckTracker           │ │
                                 │ │ SequenceTracker      │ │
                                 │ │ MissedMessageFetcher │ │
                                 │ │ EventBus             │ │
                                 │ └──────────────────────┘ │
                                 └────────────┬─────────────┘
                                              │ WSS
                                              │ /realtime
                                              ▼
                  ┌───────────────────────────────────────────────────┐
                  │           NestJS — circle_be/src/realtime/         │
                  │                                                   │
                  │   RealtimeGateway (raw ws)                        │
                  │   ├── OriginGuard / WSS enforcement               │
                  │   ├── AuthGuard (JWT verify, blacklist check)     │
                  │   ├── ConnectionManager (userId/deviceId/sessId)  │
                  │   ├── HeartbeatManager                            │
                  │   ├── RateLimiter (connection / message / IP)     │
                  │   ├── MessageRouter (envelope + Zod schemas)      │
                  │   ├── AckManager (server→client ack tracking)     │
                  │   └── ErrorCodec                                  │
                  │                                                   │
                  │   RealtimeService (business broadcasts)           │
                  │   ├── SequenceService (per-user monotonic seq)    │
                  │   ├── MessageDedupService (requestId / messageId) │
                  │   └── MissedMessageStore (recent N events / TTL)  │
                  │                                                   │
                  │   PresenceService (online status)                 │
                  │   └── local in-memory + Redis (future)            │
                  └─────────────┬─────────────────────────────────────┘
                                │
                  ┌─────────────┴─────────────┐
                  │   Redis (本期可选)         │
                  │   - Pub/Sub: cross-instance broadcast │
                  │   - presence:{userId}     │
                  │   - blacklist:token       │
                  │   - dedup:{userId}:{id}   │
                  │   - missed:{userId} (List/Stream)     │
                  └───────────────────────────┘
```

### 2.2 后端模块拆分

```
circle_be/src/realtime/
├── realtime.module.ts
├── gateway/
│   ├── realtime.gateway.ts          # WebSocketServer 装配、连接生命周期
│   ├── auth.guard.ts                 # JWT verify + blacklist
│   ├── origin.guard.ts               # Origin 白名单
│   ├── connection-manager.ts         # userId/deviceId/sessionId 绑定、踢下线 API
│   ├── heartbeat.manager.ts          # ping/pong + jitter
│   ├── rate-limiter.ts               # connection / message / IP token bucket
│   └── message-router.ts             # envelope 解码 + 路由
├── protocol/
│   ├── envelope.schema.ts            # Zod schemas（请求 / 响应 / 错误）
│   ├── message-types.ts              # type 字面量联合
│   ├── error-codes.ts                # 统一错误码常量
│   └── codec.ts                      # encode/decode + size guard
├── reliability/
│   ├── sequence.service.ts           # per-user 单调递增 sequence 分配
│   ├── dedup.service.ts              # requestId / messageId 幂等
│   ├── ack.manager.ts                # 服务端推送 → ack 等待 + 重发
│   └── missed-message.store.ts       # 离线 / 缺口补偿（in-memory / Redis）
├── presence/
│   └── online-status.service.ts      # isOnline、踢下线、跨实例查询
├── transport/
│   └── broadcaster.ts                # 抽象 broadcast：本机 / Redis Pub/Sub
├── observability/
│   ├── realtime.metrics.ts           # prom-client gauges / counters
│   └── realtime.logger.ts            # 结构化日志包装
├── config/
│   └── realtime.config.ts            # @nestjs/config schema
├── realtime.service.ts               # 业务 broadcast*（已存在，重构后保留 API）
└── __test__/
    ├── auth.spec.ts
    ├── heartbeat.spec.ts
    ├── rate-limiter.spec.ts
    ├── envelope.spec.ts
    ├── reliability.spec.ts
    ├── missed-messages.spec.ts
    └── e2e.gateway.spec.ts
```

### 2.3 前端模块拆分

```
circle-im/src/realtime/
├── index.ts                          # 公共 API：connect / disconnect / on / send
├── client.ts                         # 重写为 thin wrapper，组合下面的子模块
├── connection/
│   ├── connection-manager.ts         # FSM: idle | connecting | authed | reconnecting | failed
│   ├── auth.ts                       # auth 握手 + token 刷新
│   ├── heartbeat.ts                  # 客户端心跳兜底（30s pong watchdog）
│   ├── reconnect.ts                  # exp backoff + jitter + appstate hooks
│   └── network.ts                    # 复用 use-network-status 钩子
├── protocol/
│   ├── envelope.ts                   # Zod schemas，BE/FE 共享语义（手动同步）
│   ├── message-types.ts
│   ├── error-codes.ts
│   └── codec.ts
├── reliability/
│   ├── ack-tracker.ts                # 客户端发送 → 等待 ack + 超时
│   ├── dedup.ts                      # requestId / messageId 去重
│   ├── sequence-tracker.ts           # 检测 gap，触发补拉
│   └── missed-fetcher.ts             # 调用 REST 拉缺口
├── bus/
│   └── event-bus.ts                  # type → handler[] 映射，业务订阅入口
├── observability/
│   └── telemetry.ts                  # 上报关键事件给可观测后端
└── __tests__/
    └── ...                           # Jest + ws-mock
```

---

## 3. 协议设计（前后端共契约）

### 3.1 信封格式

**所有 WS 帧均为 UTF-8 JSON**，统一格式如下：

```ts
// 请求（client → server）
type ClientFrame = {
  v: 1;                         // 协议版本
  type: string;                 // e.g. "auth", "ping", "ack", "sub.snapshot"
  requestId: string;            // UUIDv4，client 生成；幂等键
  ts: number;                   // client 发送毫秒时间戳
  payload?: unknown;            // 由具体 type 的 schema 校验
};

// 响应（server → client，对 client request 的应答）
type ServerResponse = {
  v: 1;
  type: string;                 // 一般是 `${requestType}.ack` 或 `${requestType}.error`
  requestId: string;            // 回带客户端的 requestId
  ts: number;                   // server 发送毫秒时间戳
  code: 0 | number;             // 0 = ok；非 0 见 error-codes
  message?: string;             // 错误简述；不含堆栈
  payload?: unknown;
};

// 推送（server → client，主动推送事件）
type ServerPush = {
  v: 1;
  type: string;                 // e.g. "badge.snapshot", "wallet.balance.changed"
  messageId: string;            // server 生成；用于客户端去重展示
  sequence: number;             // 该 userId 维度单调递增
  ts: number;
  payload: unknown;
  ackRequired?: boolean;        // true = 客户端必须回 ack；缺省 false（best-effort）
};

// 客户端对推送的 ack
type ClientAck = {
  v: 1;
  type: "push.ack";
  messageId: string;
  ts: number;
};
```

### 3.2 大小与版本

- 单帧最大 `MAX_FRAME_BYTES = 32 * 1024`（32 KB），超出立即关闭连接（错误码 `PAYLOAD_TOO_LARGE`）
- 协议版本字段 `v` 当前固定为 `1`；不匹配的帧返回 `PROTOCOL_VERSION_MISMATCH` 并关闭连接
- 任何 `JSON.parse` 失败 → 返回 `INVALID_MESSAGE_FORMAT` 错误响应（无 requestId 时只发一条 error push 后关闭）

### 3.3 类型清单（v1）

**控制类（client → server）：**

| type | 说明 | 是否需要 ack |
| --- | --- | --- |
| `auth` | 鉴权握手 | 必须 |
| `ping` | 应用层心跳（除 ws 协议层 ping/pong 外的兜底） | 服务端回 `pong` |
| `push.ack` | 对 server push 的确认 | 否 |
| `sub.snapshot` | 主动请求 badge 快照 | 是 |
| `sub.missed` | 拉取 sequence ≥ N 的遗漏消息 | 是 |

**事件推送（server → client）：**

继承自现有 `RealtimeEvent` 联合（`badge.snapshot`、`friend.activity.unread.changed`、`wallet.*` 等），但**所有事件都套上 ServerPush 信封**。本期不改业务事件 type 名称，避免 breaking change。

### 3.4 错误码

```ts
export const ErrorCode = {
  OK: 0,
  // 鉴权
  AUTH_REQUIRED: 1001,
  AUTH_FAILED: 1002,
  TOKEN_EXPIRED: 1003,
  TOKEN_REVOKED: 1004,
  AUTH_TIMEOUT: 1005,
  // 协议
  INVALID_MESSAGE_FORMAT: 2001,
  UNKNOWN_MESSAGE_TYPE: 2002,
  PROTOCOL_VERSION_MISMATCH: 2003,
  PAYLOAD_TOO_LARGE: 2004,
  SCHEMA_VALIDATION_FAILED: 2005,
  // 限流 / 资源
  RATE_LIMITED: 3001,
  TOO_MANY_CONNECTIONS: 3002,
  // 业务
  FORBIDDEN: 4001,
  NOT_FOUND: 4002,
  // 服务端
  INTERNAL_ERROR: 5000,
  SERVICE_UNAVAILABLE: 5001,
} as const;
```

致命错误（鉴权类、协议类、PAYLOAD_TOO_LARGE）必须 **发送错误响应后立即关闭连接**（WS close code 选择见 4.2）。
非致命错误（schema/未知 type/限流）只发错误响应，连接保持。

### 3.5 WS close code 约定

| 场景 | close code | reason |
| --- | --- | --- |
| 鉴权失败 / 超时 | 1008 | `AUTH_FAILED` / `AUTH_TIMEOUT` |
| token 过期 / revoked | 1008 | `TOKEN_EXPIRED` / `TOKEN_REVOKED` |
| 心跳超时 | 1001 | `HEARTBEAT_TIMEOUT` |
| payload 超限 | 1009 | `PAYLOAD_TOO_LARGE` |
| 限流强制断开 | 1008 | `RATE_LIMITED` |
| 服务关闭 | 1012 | `SERVICE_RESTART`（用于优雅滚动） |
| 主动踢下线 | 4001 | `KICKED_BY_SERVER`（应用层 code，4xxx 段自定义） |

---

## 4. 后端详细设计

### 4.1 连接生命周期

```
client TCP/TLS handshake
   │
   ▼
HTTP Upgrade ─── OriginGuard (Origin in allowlist?) ───► reject 403 if no
   │
   ▼
WebSocket open
   │
   ▼
启动 AUTH_TIMEOUT 定时器 (默认 10s)
   │
   ▼
等待客户端发送第一条 frame
   │
   ├── 不是 type=auth 或 schema 不通过 ──► error AUTH_REQUIRED, close 1008
   ├── token 验证失败 ──► error AUTH_FAILED, close 1008
   ├── token blacklist hit ──► error TOKEN_REVOKED, close 1008
   └── 通过 ──► ConnectionManager.bind(userId, deviceId, sessionId)
       │
       ▼
   检查 connection 上限
       ├── 单用户连接 > MAX_CONN_PER_USER ──► error TOO_MANY_CONNECTIONS, close
       └── 单 IP 连接 > MAX_CONN_PER_IP ──► error TOO_MANY_CONNECTIONS, close
       │
       ▼
   发 auth.ack { code: 0, payload: { sessionId, serverTime, lastSequence } }
       │
       ▼
   启动 HeartbeatManager (per-socket, 25-30s + jitter)
       │
       ▼
   发 badge.snapshot 初始事件 (走推送通道)
       │
       ▼
   进入消息循环
       │
       ├── 收到 ping ──► 回 pong
       ├── 收到 push.ack ──► AckManager.confirm(messageId)
       ├── 收到 sub.* ──► MessageRouter 路由
       ├── 收到非法帧 ──► 发 schema/format 错误
       ├── pong 超时 ──► close 1001 HEARTBEAT_TIMEOUT
       ├── token 到期 ──► close 1008 TOKEN_EXPIRED
       └── 客户端关闭 / 网络断开 ──► ConnectionManager.unbind, 清理 timers/locks
```

### 4.2 ConnectionManager

```ts
export type Connection = {
  id: string;                  // sessionId (uuidv4)
  userId: string;
  deviceId: string;            // 来自 client（auth payload 提供，签名于 token 时校验绑定）
  socket: WebSocket;
  ip: string;
  connectedAt: number;
  lastActivityAt: number;
  tokenExpMs: number | null;
};

interface ConnectionManager {
  bind(socket: WebSocket, ctx: AuthContext): Connection;
  unbind(connectionId: string): void;
  byUser(userId: string): Connection[];
  byDevice(userId: string, deviceId: string): Connection | undefined;
  byId(connectionId: string): Connection | undefined;
  isOnline(userId: string): boolean;
  count(): { connections: number; users: number };

  kickUser(userId: string, reason?: string): number;          // 返回断开数
  kickDevice(userId: string, deviceId: string): boolean;
  kickConnection(connectionId: string): boolean;
}
```

实现要点：
- 内部三张表：`Map<userId, Set<Connection>>`、`Map<connectionId, Connection>`、`Map<ip, Set<connectionId>>`
- `unbind` 必须在 `socket.on('close')` 内调用，并幂等（重复 unbind 无副作用）
- 每个 Connection 持有的资源（heartbeat timer、token expiry timer、rate-limiter token bucket）在 `unbind` 内释放
- `kick*` 方法发送 `{ type: "kicked", code: 4001 }` 后 `socket.close(4001, reason)`

### 4.3 AuthGuard

```ts
interface AuthContext {
  userId: string;
  deviceId: string;
  tokenExpMs: number | null;
  scope?: string[];
}

interface AuthGuard {
  verify(token: string): Promise<AuthContext | { error: ErrorCode }>;
  isRevoked(jti: string): Promise<boolean>;
  scheduleExpiry(connection: Connection, onExpire: () => void): void;
}
```

- JWT 校验：保留现有 `JwtService.verify`
- 必填 claims：`sub`(userId)、`exp`、`jti`(用于 revoke)、`device`(deviceId)
- **黑名单**：`blacklist:jti:{jti}` Redis key，TTL 与 token 剩余生命相同；本期可先在 in-memory `Set<string>` 做接口预留
- **强制下线**：业务侧调用 `kickUser` 时同时把 jti 加入黑名单，避免用旧 token 立刻重连

### 4.4 HeartbeatManager

```
配置：
  HEARTBEAT_INTERVAL_MS = 25000
  HEARTBEAT_JITTER_MS = 5000           # 实际 ping 间隔 25~30s 随机
  PONG_TIMEOUT_MS = 10000
  MAX_MISSED_PONGS = 2

每个连接独立 timer：
  scheduleNextPing():
    delay = HEARTBEAT_INTERVAL_MS + random(0, HEARTBEAT_JITTER_MS)
    setTimeout(() => {
      socket.ping()
      missed++
      if (missed > MAX_MISSED_PONGS) socket.close(1001, "HEARTBEAT_TIMEOUT")
      else schedulePongDeadline()
    }, delay)

  on pong: missed = 0; lastActivityAt = now; scheduleNextPing()
```

放弃单一全局 setInterval 扫描所有 client（当前实现是这种），改为 per-connection 调度，配合 jitter 避免雪崩。

### 4.5 RateLimiter

三层限流，全部使用 token bucket：

| 维度 | 默认值 | 超限动作 |
| --- | --- | --- |
| 单连接消息频率 | 30/s burst 60 | 单条丢弃 + RATE_LIMITED；连续 5s 超限 → close |
| 单用户连接频率（新建） | 10/min | 拒绝 Upgrade |
| 单 IP 连接频率（新建） | 60/min | 拒绝 Upgrade |
| 单用户最大同时连接 | 5 | TOO_MANY_CONNECTIONS |
| 单 IP 最大同时连接 | 50 | TOO_MANY_CONNECTIONS |

实现：本期 in-memory bucket，接口预留 Redis 后端：

```ts
interface RateLimiter {
  tryConsume(key: string, cost?: number): Promise<{ ok: boolean; retryAfterMs?: number }>;
}
```

### 4.6 MessageRouter

```ts
const handlers: Record<string, MessageHandler> = {
  ping: handlePing,
  "push.ack": handlePushAck,
  "sub.snapshot": handleSubSnapshot,
  "sub.missed": handleSubMissed,
};

async function route(conn: Connection, raw: RawData) {
  if (raw.byteLength > MAX_FRAME_BYTES) return sendError(conn, PAYLOAD_TOO_LARGE);

  const parsed = safeJsonParse(raw);
  if (!parsed) return sendError(conn, INVALID_MESSAGE_FORMAT);

  const envelope = ClientFrameSchema.safeParse(parsed);
  if (!envelope.success) return sendError(conn, INVALID_MESSAGE_FORMAT);

  const handler = handlers[envelope.data.type];
  if (!handler) return sendError(conn, UNKNOWN_MESSAGE_TYPE, envelope.data.requestId);

  const limited = await rateLimiter.tryConsume(`conn:${conn.id}`);
  if (!limited.ok) return sendError(conn, RATE_LIMITED, envelope.data.requestId);

  const dup = await dedup.checkRequest(conn.userId, envelope.data.requestId);
  if (dup) return send(conn, dup);                        // 直接回放历史响应

  try {
    const response = await handler(conn, envelope.data);
    await dedup.rememberRequest(conn.userId, envelope.data.requestId, response, TTL_REQUEST_DEDUP);
    send(conn, response);
  } catch (err) {
    log.error(err);                                       // 不返回堆栈给客户端
    send(conn, errorResponse(envelope.data.requestId, INTERNAL_ERROR));
  }
}
```

### 4.7 AckManager（服务端推送可靠性）

适用于 `ackRequired: true` 的事件（如 `wallet.recharge.completed`）：

```ts
interface AckManager {
  send(conn: Connection, push: ServerPush): Promise<void>;
  // 内部：写入 pending Map<messageId, { push, conn, attempt, deadline }>
  // 超时未 ack 重发，最多 ACK_MAX_RETRY=3 次
  // 全部失败后写入 missed-message-store，等下次重连补
}
```

| 配置 | 默认 |
| --- | --- |
| `ACK_TIMEOUT_MS` | 5000 |
| `ACK_MAX_RETRY` | 3 |
| `ACK_BACKOFF_FACTOR` | 1.5 |

未要求 ack 的事件（如频繁的 unread count 变更）走 fire-and-forget。

### 4.8 SequenceService

每个 `userId` 维度维护单调递增 `sequence`：

```ts
interface SequenceService {
  next(userId: string): Promise<number>;          // INCR redis key
  current(userId: string): Promise<number>;
  reset(userId: string): Promise<void>;           // 仅运维用
}
```

- 实现：本期 in-memory `Map<userId, number>`，接口预留 Redis `INCR seq:{userId}`
- broadcast 前先 `next(userId)` 拿到 seq 写入 ServerPush.sequence
- snapshot 类事件不消耗 sequence（因为 snapshot 是状态全量，不存在缺口语义），但 `auth.ack` payload 要回带 `lastSequence` 让客户端校准

### 4.9 MissedMessageStore

```ts
interface MissedMessageStore {
  append(userId: string, push: ServerPush): Promise<void>;     // capped
  fetchSince(userId: string, sequence: number): Promise<ServerPush[]>;
  trim(userId: string, beforeMs: number): Promise<void>;       // TTL 清理
}
```

- 本期使用 in-memory `Map<userId, RingBuffer<ServerPush>>`，capacity = 200，TTL 24h
- 接口设计兼容 Redis Stream（`XADD stream:user:{userId}`、`XRANGE`）
- **何时写入**：所有 `ackRequired: true` 推送在发送时同步写入；可选地高优先级事件（wallet/membership）也写入
- **何时读取**：`sub.missed { lastSequence }` 请求时返回 `> lastSequence` 的事件列表

### 4.10 PresenceService

```ts
interface PresenceService {
  setOnline(userId: string, deviceId: string, sessionId: string): Promise<void>;
  setOffline(sessionId: string): Promise<void>;
  isOnline(userId: string): Promise<boolean>;
  getDevices(userId: string): Promise<{ deviceId: string; sessionId: string; since: number }[]>;
}
```

- 本期实现 = `ConnectionManager` 的薄包装，本机内存即可
- 多实例阶段：每个连接事件双写 Redis `presence:{userId}` Hash + Pub/Sub，定期 TTL 续约

### 4.11 Broadcaster（多实例预留）

```ts
interface Broadcaster {
  publish(userId: string, push: ServerPush): Promise<void>;
}

class LocalBroadcaster implements Broadcaster { /* 直接走 ConnectionManager.byUser */ }
class RedisPubSubBroadcaster implements Broadcaster {
  publish(userId, push) { redis.publish(`rt:${userId}`, JSON.stringify(push)); }
  // 启动时订阅 rt:* 通配，命中本机持有的 userId 时投递
}
```

`RealtimeService` 依赖 `Broadcaster` 接口而非直接操作 socket。本期 wire `LocalBroadcaster`，多实例阶段切到 `RedisPubSubBroadcaster`。

### 4.12 ErrorCodec / 不泄露堆栈

```ts
function errorResponse(requestId: string | null, code: ErrorCode, hint?: string): ServerResponse {
  return { v: 1, type: requestId ? "error" : "error.push", requestId: requestId ?? "", ts: Date.now(), code, message: hint };
}
```

- 服务端 try/catch 内的原始 error 只进 log（结构化），不进 message
- `process.on('uncaughtException')` / `unhandledRejection` 在 RealtimeModule 启动时挂钩，记录但不退出进程

---

## 5. 前端详细设计

### 5.1 ConnectionManager FSM

```
状态：
  idle           初始 / 主动 disconnect 后
  connecting     已 new WebSocket，等 open
  authenticating ws open，已发 auth，等 auth.ack
  connected      已收 auth.ack，可收推送 / 发请求
  reconnecting   断线后等待退避
  failed         超过最大重试 / token 不可恢复

事件：
  connect(token) idle → connecting
  ws.open        connecting → authenticating（自动发 auth）
  auth.ack       authenticating → connected
  auth.error     authenticating → idle（致命）/ reconnecting（可恢复）
  ws.close       any → reconnecting（manual=false）/ idle（manual=true）
  pong.timeout   connected → reconnecting（forced ws.close）
  appstate.background → 暂停心跳 + 保留 socket 30s，超时 disconnect
  appstate.foreground → idle/failed → connect；reconnecting → 立即触发
  network.online → reconnecting → 立即触发
  network.offline → connected → reconnecting（不消耗 attempt 计数）
```

### 5.2 鉴权握手（替换 URL token）

```ts
async function performAuth(socket: WebSocket, token: string, deviceId: string) {
  const requestId = uuidv4();
  socket.send(JSON.stringify({
    v: 1, type: "auth", requestId, ts: Date.now(),
    payload: { token, deviceId, clientVersion: CLIENT_VERSION }
  }));
  const resp = await waitForResponse(requestId, AUTH_TIMEOUT_MS);
  if (resp.code !== 0) throw new AuthError(resp.code, resp.message);
  return resp.payload as { sessionId: string; serverTime: number; lastSequence: number };
}
```

- token 不再放 URL（防止被代理日志/截图泄露）
- `deviceId` 持久化于 `expo-secure-store`，首次随机生成

### 5.3 Heartbeat（客户端兜底）

虽然原生 WebSocket 在 RN 不暴露 `ping/pong` API，但可以用应用层 `ping`：

```ts
// 应用层心跳：客户端每 30s 主动发 ping，期望 10s 内回 pong
function startHeartbeat() {
  pingTimer = setInterval(() => {
    const id = uuidv4();
    send({ type: "ping", requestId: id });
    pongDeadline = setTimeout(() => forceReconnect("PONG_TIMEOUT"), PONG_TIMEOUT_MS);
  }, HEARTBEAT_INTERVAL_MS);
}
```

服务端 `MessageRouter.handlePing` 立即回 `{ type: "pong", code: 0 }`。

### 5.4 Reconnect

```
attempt 0: 0ms（立即）
attempt n: min(BASE * 2^n, MAX) + random(0, JITTER)

BASE = 1000ms
MAX = 30000ms
JITTER = 5000ms
MAX_ATTEMPTS = ∞（用 backoff 上限保护，不强制次数上限——只要 token 还有效就一直试）
TOKEN_REFRESH 触发：连续 attempt ≥ 3 次 + close 原因为 TOKEN_EXPIRED → 主动调用 refreshToken 后重连
APPSTATE 后台 → 暂停 reconnect 计时器
```

### 5.5 AckTracker

```ts
type Pending = { resolve: (r: ServerResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
const pending = new Map<string, Pending>();

function send<T>(frame: ClientFrame, opts?: { timeout?: number }): Promise<ServerResponse> {
  socket.send(JSON.stringify(frame));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(frame.requestId);
      reject(new AckTimeoutError());
    }, opts?.timeout ?? DEFAULT_ACK_TIMEOUT_MS);
    pending.set(frame.requestId, { resolve, reject, timer });
  });
}

function onResponse(resp: ServerResponse) {
  const p = pending.get(resp.requestId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(resp.requestId);
  p.resolve(resp);
}
```

### 5.6 SequenceTracker + MissedFetcher

```ts
let lastSequence = 0;
const seenMessageIds = new LRUSet<string>(1000);    // 短期去重，避免重复展示

function onPush(push: ServerPush) {
  if (seenMessageIds.has(push.messageId)) return;          // 幂等
  seenMessageIds.add(push.messageId);

  if (push.sequence > lastSequence + 1 && lastSequence > 0) {
    // 检测到 gap → 触发补拉
    void fetchMissed(lastSequence);
  }

  if (push.ackRequired) sendAck(push.messageId);
  bus.emit(push.type, push.payload);
  lastSequence = Math.max(lastSequence, push.sequence);
}

async function fetchMissed(sinceSeq: number) {
  const resp = await send({ type: "sub.missed", requestId: uuidv4(), payload: { sinceSequence: sinceSeq } });
  for (const push of resp.payload.events) onPush(push);
}
```

重连成功后 `auth.ack.lastSequence` 与本地 `lastSequence` 对比，如果服务端更大 → 立即调用 `fetchMissed(localLastSequence)`。

### 5.7 EventBus（业务订阅入口）

```ts
type Handler<T = unknown> = (payload: T) => void;
const subs = new Map<string, Set<Handler>>();

export const realtimeBus = {
  on<T>(type: string, h: Handler<T>) { /* ... */ },
  off(type: string, h: Handler) { /* ... */ },
  emit(type: string, payload: unknown) { /* ... */ },
};
```

业务侧（`session-bootstrap.tsx`、各 store）从 `realtimeBus` 订阅，**不再直接耦合到 WebSocket**。这层引入后 `client.ts` 现有 switch-case 全部移除，事件分发走 bus。

### 5.8 AppState / Network 集成

- `useAppState`（react-native AppState）：背景 → 暂停心跳 + 30s 保留窗口；前台 → 触发立即 reconnect
- `useNetworkStatus`（已存在 `src/hooks/use-network-status.ts`）：online → 触发 reconnect；offline → 标记 socket 为 stale，不进 reconnect 计时

### 5.9 Token 过期 / 刷新

```
ws close with code 1008 reason TOKEN_EXPIRED
   → 调用 authStore.refreshToken()
   → 成功：用新 token 立即重连（attempt 计数重置）
   → 失败：FSM → failed，触发 logout
```

不在 WS 内做 token 刷新（避免半连接状态），统一走 HTTP refresh。

---

## 6. 配置（前后端）

### 6.1 后端 `.env`

```
REALTIME_PATH=/realtime
REALTIME_REQUIRE_WSS=true                        # 生产强制
REALTIME_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
REALTIME_HEARTBEAT_INTERVAL_MS=25000
REALTIME_HEARTBEAT_JITTER_MS=5000
REALTIME_PONG_TIMEOUT_MS=10000
REALTIME_MAX_MISSED_PONGS=2
REALTIME_AUTH_TIMEOUT_MS=10000
REALTIME_MAX_FRAME_BYTES=32768
REALTIME_MAX_CONN_PER_USER=5
REALTIME_MAX_CONN_PER_IP=50
REALTIME_RATE_MSG_PER_SEC=30
REALTIME_RATE_MSG_BURST=60
REALTIME_RATE_NEW_CONN_PER_USER_PER_MIN=10
REALTIME_RATE_NEW_CONN_PER_IP_PER_MIN=60
REALTIME_ACK_TIMEOUT_MS=5000
REALTIME_ACK_MAX_RETRY=3
REALTIME_MISSED_BUFFER_SIZE=200
REALTIME_MISSED_BUFFER_TTL_MS=86400000
REALTIME_REDIS_URL=                              # 留空 = 禁用 Redis 后端，单实例模式
```

通过 `@nestjs/config` + zod schema 校验，启动时缺失致命项 → fail fast。

### 6.2 前端 `EXPO_PUBLIC_*`

```
EXPO_PUBLIC_REALTIME_WS_URL=wss://...
EXPO_PUBLIC_REALTIME_HEARTBEAT_MS=30000
EXPO_PUBLIC_REALTIME_PONG_TIMEOUT_MS=10000
EXPO_PUBLIC_REALTIME_RECONNECT_BASE_MS=1000
EXPO_PUBLIC_REALTIME_RECONNECT_MAX_MS=30000
EXPO_PUBLIC_REALTIME_RECONNECT_JITTER_MS=5000
EXPO_PUBLIC_REALTIME_AUTH_TIMEOUT_MS=10000
EXPO_PUBLIC_REALTIME_ACK_TIMEOUT_MS=8000
```

集中在 `src/realtime/config.ts`，业务侧不直接读 env。

---

## 7. 安全

| 措施 | 说明 |
| --- | --- |
| 强制 WSS | `REALTIME_REQUIRE_WSS=true` 时拒绝 `ws://` 升级；通过反向代理 `X-Forwarded-Proto` 判断 |
| Origin 校验 | OriginGuard 比对 `REALTIME_ALLOWED_ORIGINS`；移动端原生 WS 无 Origin → 走 `User-Agent` + token 双重校验 |
| Token-only userId | 任何 client 提交的 userId/role/permission 一律忽略，仅以 JWT.sub 为准 |
| Schema 强校验 | 所有 client frame 走 Zod schema，未知 type / 缺字段 / 错类型 一律拒绝 |
| Payload 上限 | 单帧 32KB；超过即关闭 |
| JSON.parse 防爆 | 在 try/catch 中执行；增加深度限制（可选 `secure-json-parse` 库） |
| 不泄露堆栈 | server 错误只回 ErrorCode + 短描述，stack 进 logger |
| 黑名单 | `kickUser` 同时把 jti 加 blacklist；blacklist TTL = token 剩余 exp |
| 反恶意重连 | 单 IP / 单 userId 新建连接限速；同一连接 5s 内连续超限自动关闭 |
| 二次校验 | 任何敏感操作（如 `wallet.recharge.completed`）服务端推送时不带绝对余额 ↔ 客户端走 REST 校验（已是当前做法，保留） |

---

## 8. 可观测性

### 8.1 结构化日志

```ts
log.info("realtime.connect", { connectionId, userId, deviceId, ip, userAgent });
log.info("realtime.disconnect", { connectionId, userId, code, reason, durationMs });
log.warn("realtime.auth_failed", { ip, reason });
log.warn("realtime.rate_limited", { connectionId, userId, key });
log.warn("realtime.heartbeat_timeout", { connectionId, userId });
log.error("realtime.internal_error", { connectionId, error: serializeError(err) });
log.info("realtime.message_in", { connectionId, type, requestId, sizeBytes });
log.info("realtime.message_out", { connectionId, type, messageId, sequence, sizeBytes, ackRequired });
log.info("realtime.ack_received", { connectionId, messageId, latencyMs });
log.warn("realtime.ack_timeout", { connectionId, messageId, attempt });
```

字段固定、采样可调（高频 `message_in/out` 默认 1% 采样，错误 100%）。

### 8.2 Metrics（prom-client）

| 名称 | 类型 | labels | 说明 |
| --- | --- | --- | --- |
| `realtime_connections_active` | gauge | - | 当前在线连接数 |
| `realtime_users_online` | gauge | - | 当前在线用户数 |
| `realtime_messages_in_total` | counter | type | 入向消息数 |
| `realtime_messages_out_total` | counter | type, ack_required | 出向消息数 |
| `realtime_message_latency_ms` | histogram | type | 推送→ack 延迟 |
| `realtime_ack_success_total` | counter | type | ack 成功 |
| `realtime_ack_timeout_total` | counter | type | ack 超时 |
| `realtime_auth_failed_total` | counter | reason | 鉴权失败 |
| `realtime_rate_limited_total` | counter | scope | 限流触发 |
| `realtime_disconnect_total` | counter | code, reason | 断开原因分布 |
| `realtime_reconnect_total` (FE) | counter | reason | 客户端重连次数 |

暴露 `/metrics` 给 Prometheus（NestJS 现有 Prometheus 模块或 `prom-client` 直接挂）。

### 8.3 客户端遥测

仅上报关键事件（不含 PII），通过现有埋点 SDK 或者轻量 batch fetch：

- `realtime.connect_failed` { reason, attempt }
- `realtime.gap_detected` { lostCount }
- `realtime.token_refresh_triggered`
- `realtime.disconnect_reason` { code }

---

## 9. 多实例扩展（预留）

本期不上线，但接口必须为之准备：

- `Broadcaster` 接口存在两实现：`LocalBroadcaster`（默认）与 `RedisPubSubBroadcaster`（feature flag `REALTIME_REDIS_URL` 非空时启用）
- `PresenceService` 抽象 `online-status.service`，本期 in-memory，未来实现 `RedisPresenceService`（Hash + TTL 续约 + Pub/Sub 失效广播）
- `SequenceService` 用 Redis `INCR` 即可分布式
- `RateLimiter` 多实例需要 Redis token bucket（如 `redis-rate-limit`），接口已抽象
- `MissedMessageStore` 切换到 Redis Stream（`XADD` + `XRANGE`）

切换标志：

```
REALTIME_REDIS_URL 非空 → Broadcaster/Presence/RateLimiter 自动切到 Redis 实现
```

---

## 10. 测试矩阵

### 10.1 后端单测 / 集成测试（Jest + ws）

| 用例 | 期望 |
| --- | --- |
| 正常 auth + 收 snapshot | 200 / 收到 badge.snapshot |
| 缺少 auth | 10s 超时 close 1008 AUTH_TIMEOUT |
| 错误 token | close 1008 AUTH_FAILED |
| 过期 token | close 1008 TOKEN_EXPIRED |
| 黑名单 token | close 1008 TOKEN_REVOKED |
| 心跳超时 | 30+10s 后 close 1001 HEARTBEAT_TIMEOUT |
| 非法 JSON | 错误响应 INVALID_MESSAGE_FORMAT，连接保持 |
| 未知 type | 错误响应 UNKNOWN_MESSAGE_TYPE，连接保持 |
| 超大 payload | close 1009 PAYLOAD_TOO_LARGE |
| 高频请求 | 错误响应 RATE_LIMITED，连续超限触发 close |
| 重复 requestId | 服务端返回上次响应（幂等） |
| 重复 messageId 推送 | 客户端只触发一次（FE 测试） |
| 6 个连接（>MAX=5） | 第 6 个 TOO_MANY_CONNECTIONS |
| kickUser | 全部连接收到 kicked 消息后 close 4001 |
| 服务端业务异常 | 客户端收 INTERNAL_ERROR，无堆栈，连接保持 |
| 优雅关闭 | onModuleDestroy 时所有连接 close 1012 SERVICE_RESTART |

### 10.2 前端单测（Jest + mock-socket）

- FSM 状态转移（idle→connecting→authenticating→connected→reconnecting→connected）
- 重连退避数值（mock timer，验证 1s/2s/4s/.../30s+jitter）
- AckTracker 超时拒绝
- SequenceTracker gap 触发 fetchMissed
- 重复 messageId 不重复触发 handler
- AppState background → pause heartbeat
- AppState foreground → 立即 reconnect
- Network offline → 不消耗 attempt
- token expired close → 触发 refreshToken 后重连

### 10.3 端到端

加入 1 个简单 e2e（Playwright 或 Detox）：登录 → 收到 snapshot → 模拟断网 5s → 恢复 → 验证 badge 数与服务端一致。

---

## 11. 分阶段实施计划

总共拆 7 个 phase，每个 phase 独立可上线、独立可回滚。每个 phase 自带验收标准，全部通过后再进入下一 phase。

### Phase 1 — 协议骨架 + 配置外置（前后端，~1.5 天）
- 引入 `protocol/envelope.schema.ts`（前后端各一份，schema 内容一致）
- 错误码常量 `error-codes.ts`
- 前后端配置外置到 env（不改业务行为）
- 兼容老协议：服务端同时接受老格式和新信封；客户端先发老格式，下个 phase 切换
- **验收**：现有业务无回归；新 schema 通过单测

### Phase 2 — 鉴权升级 + ConnectionManager（后端，~1 天）
- 抽出 `ConnectionManager`，内部三张表
- 移除 URL token legacy 路径（保留 1 个 release 标记 deprecated，下版本删除）
- 实现 `kickUser/kickDevice/kickConnection` API
- 增加 `auth.ack` 响应 payload 含 `sessionId / serverTime / lastSequence`
- **验收**：已有测试不挂；`kickUser` 测试通过

### Phase 3 — 心跳 + 限流 + payload guard（后端，~1 天）
- per-connection 心跳（替换全局 setInterval）
- RateLimiter（in-memory token bucket）
- payload size enforcement
- Origin allowlist
- **验收**：测试矩阵 10.1 中"心跳超时"、"超大 payload"、"高频请求"通过

### Phase 4 — 协议 envelope 切换 + MessageRouter（前后端，~1.5 天）
- 后端 MessageRouter 全量启用，老格式拒绝（与 Phase 1 配合，留充足客户端发版窗口）
- 前端 client.ts 全部改造为子模块组合（FSM、Codec、AckTracker）
- 业务订阅迁移到 EventBus
- **验收**：badge / wallet / membership 全链路通过；老客户端拿不到事件（需要发版强制升级或保留 1 版兼容期）

### Phase 5 — 可靠性（前后端，~2 天）
- SequenceService（in-memory）
- DedupService（requestId / messageId）
- AckManager（服务端推送可重发）
- MissedMessageStore（in-memory ring）
- 客户端 SequenceTracker + MissedFetcher
- `sub.missed` API
- **验收**：模拟断网 30s 后重连，不丢任何 ackRequired 事件

### Phase 6 — 可观测性 + 黑名单（后端，~1 天）
- 结构化日志全量
- prom-client metrics
- 客户端遥测
- Token 黑名单 in-memory 实现 + `kickUser` 自动 revoke
- **验收**：`/metrics` 暴露所有目标指标；Grafana 面板可用

### Phase 7 — 多实例预留（后端，~1 天）
- 抽出 `Broadcaster / PresenceService / RateLimiter / SequenceService / MissedMessageStore` 接口
- Redis 实现版本（feature flag 关闭）
- 启动时根据 `REALTIME_REDIS_URL` 选择实现
- **验收**：单元测试覆盖两份实现；环境变量切换不影响业务行为

---

## 12. 兼容与发版策略

- Phase 1 + 4 之间需要 1 个发版周期作为客户端推全；推全率 < 95% 不切断老协议
- 移除 URL token：旧客户端发现 `auth-required` close code 时回退到 token 刷新流程，UI 提示升级
- 关键事件（wallet/membership）灰度切到新协议，badge 类先全量

---

## 13. 验收标准（与原始需求 §17 对齐）

| 需求 | 验证方法 |
| --- | --- |
| 未登录用户无法连接 | Phase 2 自动化测试 |
| token 伪造无法连接 | Phase 2 自动化测试 |
| 心跳异常自动断开 | Phase 3 自动化测试 |
| 高频请求被限流 | Phase 3 自动化测试 |
| 大消息被拒绝 | Phase 3 自动化测试 |
| 服务端不会因非法 JSON 崩溃 | Phase 1 + 静态扫描 + 故障注入 |
| 客户端断网后能自动重连 | Phase 4 + 手测 |
| 重连后能补齐遗漏消息 | Phase 5 自动化测试 |
| 同一用户多端连接正常 | Phase 2 自动化测试 |
| 能主动踢用户下线 | Phase 2 自动化测试 |
| 日志可定位连接和消息问题 | Phase 6 人工演练 |
| 关键参数可配置 | Phase 1 自检 |
| 完整测试覆盖 | 全 phase 累积 |

---

## 14. 风险与开放问题

1. **deviceId 来源**：当前 token 不含 device claim，需要在 auth 服务签发时加入。需要协调 auth 团队 / 自己改。**待定**：本期是否同时改 token 结构，还是 deviceId 由客户端 secure-store 生成不绑 token。
2. **消息持久化粒度**：MissedMessageStore in-memory 在服务重启时全失。是否需要 Phase 5 直接落 Redis？决策依赖业务对"重启窗口内事件丢失"的容忍度。
3. **Origin 校验对 RN 移动端**：移动端原生 WS 不发 Origin。当前方案靠 token + UA 白名单代偿，需要确认安全审计可接受。
4. **WSS 强制对 LAN 开发**：本地 dev 仍允许 ws://；CI 与生产强制 WSS。`REALTIME_REQUIRE_WSS` 默认 true，dev 显式 false。
5. **OpenIM 共存**：本通道与 openim 各跑一条 WS，移动端会有两条长连接。当前可接受；如果对电量/资源敏感，未来可考虑把业务事件让 openim 透传，但成本远大于收益，暂不做。

---

## 15. 后续 Plan / Phase 文档位置

每个 Phase 落地时分别写一份 plan：

```
docs/superpowers/plans/2026-MM-DD-realtime-phase-1-protocol-skeleton.md
docs/superpowers/plans/2026-MM-DD-realtime-phase-2-auth-connection.md
...
```

实施按 plan 走，每个 plan 包含具体任务列表、改动文件、测试清单、回滚步骤。

