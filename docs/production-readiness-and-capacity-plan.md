# 生产就绪度审计 & 高并发容量方案

> 范围：`circle-im`（Expo RN 前端）+ `circle_be`（NestJS 后端）+ `openim-docker`（IM 基础设施）
> 审计日期：2026-07-04
> 方法：8 维度多智能体深读全部源码 + 部署配置；产出的 29 条 critical/high 结论各派独立 agent 以"证伪"立场逐条核查，**29/29 全部确认**，下文每条均附 `file:line` 证据。

---

## 0. 总结论（TL;DR）

**代码架构质量高于同阶段项目平均水平，且是为水平扩展设计过的；但部署形态是测试级的。当前状态：不能上生产、撑不了高 QPS、谈不上高可用。**

关键点：最致命的几个问题都是"几行配置"级别，**这是一条修配置 + 补运维的路，不是重构的路。**

| 判定项 | 结论 |
|---|---|
| 生产就绪 | ❌ 否（内测/封闭测试可以） |
| 高 QPS | ❌ 否（当前实际硬顶约 5 QPS；P0 修完可到中等量级；1 万在线需 P2 拓扑） |
| 高可用 | ❌ 否（单 VM、RPO=∞、故障靠人肉发现） |

| 维度 | 代码质量 | 部署现状 | 高 QPS / HA |
|---|---|---|---|
| 后端架构 (NestJS) | ⭐⭐⭐⭐ 分层清晰、校验/错误封装规范 | 两个 boot-order bug | 修配置后可以 |
| 数据层 (Prisma/PG) | ⭐⭐⭐⭐ 索引意识强、keyset 分页 | 连接池 10、无调优 | 否，有明确崩溃顺序 |
| 水平扩展性 | ⭐⭐⭐⭐ 代码几乎 replica-ready | 生产没 Redis，全部退化 | 2 副本今天就会坏 |
| 部署/可用性 | — | 单 VM、无备份、无回滚 | ❌ 最弱一环 |
| OpenIM 消息层 | ⭐⭐⭐⭐ BE 集成层成熟 | 默认密钥公网裸奔 | 单节点 ~1 万连接封顶 |
| 前端 (Expo RN) | ⭐⭐⭐⭐ API 层健壮、列表规范 | session 过于易碎 | 会放大后端故障 |
| 安全/认证 | ⭐⭐⭐⭐ argon2id、无 IDOR | 邮件根本发不出去 | — |
| 可观测性 | ⭐⭐⭐⭐ 埋点齐全 | 生产什么都没接 | 3 点故障没人知道 |

---

## 1. 已验证的关键阻塞项（放真实流量前必须清）

> 全部经对抗验证 `confirmed=True`。序号即优先级。

### P0-1 · `trust proxy` 未设 → 全站硬顶 ~5 QPS
Express 从未 `app.set('trust proxy')`，而所有流量经 Caddy 反代进来，于是**所有限流器把全部用户 key 到同一个 Caddy 容器 IP**。
- 证据：`circle_be/src/setup.ts:184-207,357-363`（createLimiter 无 keyGenerator，全局 300 req/min）；`docker-compose.prod.yml:99-100`（circle_be 仅 expose，不发布主机端口）+ `deploy/Caddyfile.admin:6`。
- 影响：全局 300 req/min 变成"全站每分钟 300 请求"（~5 QPS）；任何人失败登录 10 次 = **全站锁登录 15 分钟**；per-attacker 防爆破彻底失效。
- 修复：`app.set('trust proxy', 1)` + Caddy 覆写/清洗 `X-Forwarded-For`；staging 验证 `req.ip` 为真实客户端 IP 后再放量。

### P0-2 · 数据库连接池 = 默认 10，无获取超时
`new PrismaPg({ connectionString })` 未传池参数（`src/prisma/prisma.service.ts:39-45`），pg.Pool 默认 `max=10` 且 `connectionTimeoutMillis=0`（永久等待）。driver adapter 模式下 URL 里的 `connection_limit` 也不生效。
- 影响：整个后端只有 10 个 DB 连接。好友请求持锁跨 4-6 查询、点赞是 Serializable 事务重试 3 次——**~50 并发即占满，其余请求无限排队而非快速失败，p99 全线雪崩**。
- 修复：`new PrismaPg({ connectionString, max: <按机型>, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })`；compose 里给 Postgres 调 `shared_buffers/effective_cache_size/max_connections`；池饱和度打进 metrics。

### P0-3 · 生产栈没有 Redis → 缓存/限流/backplane 全静默退化
`docker-compose.prod.yml` 无 redis 服务，`gen-env.sh` 不产 `REDIS_URL`，Joi 又把它标为 optional。
- 证据：`redis.service.ts:29-36`（空 URL → `isEnabled()=false`），`realtime.service.ts:232-239`（backplane 订阅直接 early-return），`setup.ts:188-195`（限流 store 退化进程内存）。
- 影响：徽章缓存、Lua CAS 版本缓存、分布式限流、realtime 扇出**全部退化成进程内存**；每个 WS 连接跑 4 个 `count(*)`；**一旦起第 2 个副本，realtime 事件丢一半**（A 副本产生的通话邀请/未读永远到不了 pin 在 B 副本的用户）。
- 修复：compose 加 `redis:7-alpine`（内网 + 密码）；`gen-env.sh` 产出 `REDIS_URL`；生产环境 Joi 改 `.required()`。

### P0-4 · OpenIM 栈默认密钥公网裸奔
- 证据：`openim-docker/.env:58` `HOST_BIND_IP=0.0.0.0`；`.env:51` `OPENIM_SECRET=openIM123`（开源默认值，Mongo/Redis/MinIO 同为 openIM123）；`docker-compose.yaml:344-346` 网关 10001 / API 10002 公网；`:76-78` **etcd 12379/12380 硬编码无 HOST_BIND_IP 前缀（恒 0.0.0.0）且认证被注释**。
- 影响：任何知道 IP 的人可用公开默认密钥调 `/auth/get_admin_token` **冒充任意用户收发/删除消息、解散群、踢人**；公网无认证 etcd 可改写服务发现直接打挂整个 IM 数据面。这是**完全接管 + 完全宕机**双向量。
- 修复：`HOST_BIND_IP=127.0.0.1`，删 etcd 端口映射（容器内网可达），全部 openIM123 换生成密钥，10001/10002 走 Caddy TLS（wss/https），开 etcd auth。

### P0-5 · MinIO 公网 9000 + 整桶匿名下载
- 证据：`docker-compose.prod.yml:39`（`9000:9000` 无 loopback 绑定）；`:64` `mc anonymous set download local/circle`（整桶）；`upload.service.ts:48-71,317-324` 每次启动重新贴 `Principal:'*'` 策略覆盖 avatars/covers/posts/notes/**chat**/uploads；`gen-env.sh:57` `MINIO_PUBLIC_URL=http://PUBLIC_IP:9000`（明文）。
- 影响：**所有上传媒体——含私聊图片/视频（chat 前缀）和个人笔记——任何匿名请求者按 URL 即可读，明文 HTTP**。key 是 UUID 不可枚举，但会经缓存/日志/截图/分享链接泄漏。
- 修复：MinIO 前置 TLS；匿名读只保留真正公开前缀，chat/notes 改短时效 presigned GET（服务已支持 `createPresignedGetUrl`）；停止公网发布 9000。

### P0-6 · 生产只有 ConsoleMailer → 真实用户永远收不到验证码
`auth.module.ts:40` 硬编码 `{ provide: MAILER, useClass: ConsoleMailer }`（只打日志），而 `email-verification.service.ts:39` 生产环境关闭 dev bypass（返回 null）。
- 影响：**真实用户注册和验证码登录完全不可用**，只有预置密码账号能登。
- 修复：接真实 Mailer（SMTP/163/阿里云）按 env 选择，生产 env 校验必填，部署前 gate 一次测试发送。

### P0-7 · 零备份，RPO = ∞
仓库 grep 不到任何 `pg_dump/mongodump/pg_basebackup/wal-g/restic` 或快照工具；`docker-compose.prod.yml:141-145` 是裸 local volume；DEPLOY.md 从未提备份。
- 影响：**磁盘损坏 / 误 `down -v` / 勒索 / 实例丢失 → 所有账号、笔记、朋友圈、聊天记录、媒体永久丢失，无恢复路径**。全部发现里最优先的一条。
- 修复：每日 `pg_dump -Fc` + `mongodump` + `mc mirror` 到腾讯 COS（异机）+ 保留策略 + **演练一次恢复**；开 Lighthouse 自动快照做第二层；条件允许上 wal-g PITR。

### P0-8 · CORS boot-order bug → 生产 admin 后台上线即全挂
`resolveCorsOriginChecker()` 在 `.env.production` 被 ConfigModule 加载**之前**就从 `process.env.ALLOWED_ORIGINS` 捕获了（`main.ts:33-40` 经 `buildNestFactoryOptions()` 作为 `NestFactory.create` 参数于 `main.ts:127` 提前求值），生产环境 allowlist 恒为空。
- 影响：admin web 后台每个 XHR 被 CORS 拒；移动端无 Origin 头不受影响 → **极易漏测，上线才发现后台全挂**。
- 修复：`NestFactory.create` 之后再 `app.enableCors({ origin: resolveCorsOriginChecker(mergedConfig) })`，或在 per-request 回调里惰性读 env；加 boot 日志打印生效 allowlist + 带挂载 env 的集成测试。

### P0-9 · 无真实健康检查，401 算"健康"
compose healthcheck 打 `/api/v1/outbox/health`（`docker-compose.prod.yml:101-110`，`<500` 即健康），但该路由在 `@UseGuards(JwtGuard, AdminGuard)` 后（`outbox/outbox.controller.ts:14`），**无 token 探针恒得 401、根本不碰 DB/Redis**。
- 影响：DB 连接池耗尽/Prisma 断连的进程照样上报 healthy，Caddy 继续路由，用户全 500 而编排显示 green。
- 修复：加无鉴权 `GET /healthz`（liveness）+ `GET /readyz`（`SELECT 1` + Redis ping），healthcheck 改认 `==200`；配 autoheal（docker restart 策略不响应 unhealthy）。

### P0-10 · 监控/告警生产未部署 + Sentry 双端休眠
`monitoring/` 是本地模板（`monitoring/prometheus/prometheus.yml:23` scrape target 是 `host.docker.internal:3000`，Grafana `admin/admin`，`:latest` 镜像），`docker-compose.prod.yml` 不含任何监控服务，DEPLOY.md 零提及。Sentry 前后端 DSN 均注释掉（BE `error-aggregation.service.ts:151-165` 无 DSN 即 Noop；FE `sentry.ts:55-58` 无 DSN 即 no-op）。
- 影响：**凌晨 3 点故障，第一个告警是用户投诉**。写好的 5xx/p95/内存告警规则在生产是死配置。
- 修复：监控栈上服务器，scrape `circle_be:3000` + 加 `METRICS_AUTH_TOKEN` bearer + 补磁盘/outbox 积压告警；双端填 Sentry DSN（接线早已完成）。

### P0-11 · 无日志轮转 + ~15 容器无内存限制
三个 compose 文件均无 `logging:` 选项（默认 json-file 无限增长），而 `gen-env.sh:44-51` 生产把 5 个日志开关全开；所有容器无 `mem_limit`（Kafka 堆限制在 `openim-docker/docker-compose.yaml:178` 被注释掉）；DEPLOY.md 容量还按已放弃的 Oracle 12GB 机器写。
- 影响：磁盘写满 → Postgres WAL PANIC → 全栈宕机（且无磁盘告警规则）；首次流量尖峰或在线构建镜像时 OOM killer 大概率先杀 Postgres/Mongo。
- 修复：`/etc/docker/daemon.json` 设 `{"log-driver":"json-file","log-opts":{"max-size":"50m","max-file":"5"}}`；每容器加 `mem_limit`（DB 给 reservation）；换 ≥8GB（建议 16GB）机型；镜像异机构建；winston logs 挂 named volume。

### P0-12 · 前端 session 过于易碎 → 后端重启 = 群体登出风暴
三条路径在**瞬时故障（超时/网络/5xx，不只是 401）**下清 SecureStore session：
- `client.ts:454-457` `refreshAccessToken().catch → clearLocalSession()` 无差别
- `session-bootstrap.tsx:150-154` 冷启动 `/auth/me` 两次快速失败后无条件 `clearLocalSession()`
- `listeners.ts:103-111` OpenIM token 过期 → 清**整个**会话
影响：**后端每次重启/部署/>15s 延迟尖峰 = 一批用户被登出 + 同步重登风暴打回同一台机器**。另 realtime WS 重连 10 次（`realtime/client.ts:110`）后永久放弃，通话邀请/徽章再也收不到。
修复：仅在明确 401/403 时清 session；瞬时错误保留 session 进降级态；WS 去掉重连上限改 capped-backoff-forever，每次重连从 store 读最新 token。

### P0-13 · IM token 三死角
- refresh 只返回 `{accessToken, refreshToken}`，从不补发 imToken（`auth.service.ts:373-423`）
- OpenIM 登录时宕机 → `resolveImToken` 返回 `''` → 永不重试（该 session 整个生命周期无 IM）
- IM token 过期 → 清全局 session（业务 refresh token 还有效也被清）
修复：加 `GET /auth/im-token`（业务 token 守卫）；`onUserTokenExpired` 改为拉新 imToken + 重登 SDK，而非 `clearLocalSession`；`refresh()` 也返回 imToken。

---

## 2. QPS 崩溃顺序（修完 P0-1/P0-2 之后的下一批瓶颈）

按代码实测的用户可感知劣化顺序：

1. **WS 徽章 count(*) 放大**：无 Redis 时每个 WS 连接跑 4 个 count（`realtime.service.ts:326-349`），每次点赞/评论触发实时 count 广播（`realtime.service.ts:403-421,437-455`）——直打 Postgres。
2. **trace feed fan-out-on-read**：`getAcceptedFriendIds` 不带 take（上限 5000 好友），`fromID IN(...)` 让 `[fromID, createdAt, id]` 索引无法按全局时间序输出，**每页 bitmap 扫全部可见 traces 再 top-N 排序 + 每页 20×20 include 树**。大好友量用户每次下拉刷新 = 全表级操作（`trace.service.ts:109-175,554-563`）。
3. **Notification count 风暴**：表只有 `[toUserID]` 索引（`schema.prisma:986-987`），unread count 每次互动实时触发，表只增不删——热门用户被点赞一波 = 最大表上的 count(*) 风暴。
4. **toggleLike Serializable 重试风暴**：`trace.service.ts:354-386` 用 Serializable 事务打单个热点计数行，热门帖并发点赞产生 P2034 中止 + 重试（每次占用池连接跨 3+ round trip）。
5. **OpenIM 网关 fd 上限 ~1 万**：验证 agent 追到 mage 源码 `Setrlimit(RLIMIT_NOFILE, 10000)`——号称 10 万连接是纸面数字，限流/熔断默认关闭（`config/openim-msggateway.yml:32,41`）。
6. **outbox 20 行/分钟**：好友/群同步 `@Cron(EVERY_MINUTE)` + 批量 20 + 串行（`friend-sync-outbox.processor.ts:6,32`），高负载下 OpenIM 关系落后 Postgres 无界增长——"App 里是好友但聊不了天"。

---

## 3. 容量测算：10~20 万注册、1 万同时在线 ≈ 多少 QPS

### 3.1 REST API（打 circle_be）

| 流量来源 | 依据 | QPS |
|---|---|---|
| 朋友圈新帖轮询 | 前端每 30s 轮询（前台就轮，不管在哪个 tab，`moments-feed.tsx:86-106`） | 10000/30 ≈ **333** |
| 自然操作（刷 feed、进个人页、点赞、切 tab refetch） | 活跃用户 1~2 请求/分钟 | 170~330 |
| 徽章/未读、token refresh、上传 presign 等 | 零碎 | 50~100 |

- **稳态 ≈ 550~750 QPS**；晚高峰 ×2 ≈ **1000~1500 QPS**。
- 若按 P1 把 30s 轮询改成 WS 推送，直接砍掉 333，稳态降到 **~250~450 QPS**。

### 3.2 长连接
1 万在线 = **1 万条 circle_be realtime WS + 1 万条 OpenIM msggateway WS = 2 万条常驻 socket**。
⚠️ **OpenIM 网关 fd 上限就是 10000——1 万在线正好顶死，还没算 Kafka/Mongo 客户端占用的 fd。**

### 3.3 IM 消息
假设 15% 在聊天、每人 15s 一条 ≈ **100 msg/s 入站**；群聊扇出（一条 100 人群消息 = 100 次投递），出站按 5~10× ≈ **500~1000 投递/s**。Kafka 本身无压力，压力在单容器内那条 msgtransfer/push 流水线和共享 CPU。

### 3.4 数据库
1000 REST QPS × 每请求 3~5 查询 ≈ **3000~5000 DB QPS**，且混着 feed fan-out-on-read 重查询和每次互动的 count(*)。

### 3.5 媒体带宽（最易忽略）
1 万在线刷图，5% 并发拉 500KB 图 ≈ **2Gbps 级出口**。Lighthouse 套餐带宽 30~200Mbps——**图片走 CDN 不是优化项，是这个量级的生存条件**。

### 3.6 当前架构在此量级的结局
trust proxy 没修 = 全站 5 QPS，连 0.5% 的量都进不来；修完后 10 连接池 ~50 并发雪崩；就算池调大，单 Postgres 扛不住 feed 重查询 + count 风暴；OpenIM 单网关 fd 顶死在 1 万；outbox 20 行/分钟随便超；一台 VM 内存和带宽物理上就不够。
**结论：单机形态无论怎么调参都到不了 1 万在线，必须走 P2 拓扑。**

---

## 4. 支撑 1 万在线的目标架构

```
                     CDN（图片/视频，回源 COS）
                          │
用户 ──► CLB / Caddy ──┬─► circle_be × 2~3 副本（各 4C8G）
                       │     └─ REST + realtime WS（Redis backplane 扇出）
                       ├─► OpenIM 节点（4C16G，msggateway 拆独立容器 ×2，ulimit 调 10w+，前置 TLS）
                       │     └─ Kafka / Mongo(replicaSet) / etcd 内网
                       ├─► TencentDB PostgreSQL（4C16G 起，读写分离可后置）
                       ├─► 云 Redis（2~4G：缓存 + 限流 + backplane）
                       └─► COS（替掉自建 MinIO）+ LiveKit Cloud（已是云）
独立小机：Prometheus/Grafana/Alertmanager + Uptime-Kuma
```

**预算感（腾讯国际站，月）**：2× 应用机 + 1× OpenIM 机 ≈ $150~250；TencentDB PG ≈ $80~150；Redis ≈ $20~40；COS+CDN 按量（图片社交大头，几十到几百刀）。合计 **$300~600/月** 量级。

### 在 1 万在线从"建议"变"硬性"的事项

| 事项 | 为什么在 1 万在线是硬性的 |
|---|---|
| P0 全部 | 前提中的前提 |
| 轮询改 WS 推送 + 焦点 refetch 加 TTL | 砍掉 1/3+ 的 REST QPS，省一台机器 |
| Notification 复合索引 + unread 部分索引 + badge 广播去抖 | 每秒几百次互动 = count 风暴，第一个用户可感知卡点 |
| **Feed 改 fan-out-on-write（timeline 表按 viewerId 建索引）** | fan-out-on-read 在 10 万社交图上 O(N)/页，无绕过办法 |
| FE session 硬化 + WS 重连去上限 | 一次部署 = 1 万人重连风暴；现在代码还会全登出，风暴 ×2 |
| WS 连接时的 4 个 count(*) 走 Redis 快照 | 重连风暴 = 瞬时 4 万条查询，部署后雪崩的直接引信 |
| outbox 加即时 kick + 批量并发 + SKIP LOCKED | 20 行/分钟几分钟就积压 |
| cron 分布式锁 + throttler Redis storage + 按用户 channel 订阅 | 多副本正确性前提 |
| 压测验收 | k6 打 1500 QPS 混合场景 + 模拟 1 万 WS 同时重连，不达标不上量 |

---

## 5. 架构优点（不用重做，避免误伤）

- 无状态 JWT + Postgres 存储的 refresh token rotation，带重用检测（`refresh-token.service.ts:83-130`）
- 事务性 outbox + CAS 认领 + 陈旧锁恢复 + 指数退避（`friend-sync-outbox.processor.ts`）
- Redis pub/sub realtime backplane + Lua CAS 版本化缓存防陈旧覆盖（`realtime.service.ts` / `redis.service.ts:104-144`）
- MinIO presigned 直传，媒体不过 Node 事件循环（`upload.controller.ts:47-100`）
- 两个 feed 均 keyset(cursor) 分页 + 专用复合索引（`schema.prisma:769,1081-1085`）
- 全局 ValidationPipe（whitelist + forbidNonWhitelisted）+ 统一 `{code,message,data,errorCode}` 封装 + request-id 贯穿日志
- 优雅停机带 Sentry flush（`main.ts:97-121`）
- argon2id 密码/验证码哈希，账号枚举安全的登录错误，抽样 note/trace/friend/temp-chat **无 IDOR**
- 前端：单飞 token refresh（防并发风暴）、每请求 15s 超时、统一 ApiError + errorCode i18n、热列表全用 FlatList、IM 消息内存上限 200 条

> 真正难的多实例问题（会话、上传、outbox、realtime）代码里都已解决——**是部署配置让这些设计失效，而不是设计本身有问题**。

---

## 6. 修复路线图

### P0 — 本周内，让机器能安全见人（多数配置级，约几天）
1. `trust proxy` + Caddy XFF 清洗
2. Prisma 池配置 + Postgres 基础调优
3. compose 加 Redis + `REDIS_URL` 生产必填
4. OpenIM：绑回环 / 删 etcd 公网端口 / 换全部默认密钥 / 前置 TLS
5. MinIO：chat/notes 撤匿名读改 presigned GET，停止公网发布 9000
6. 接真实 Mailer
7. 每日备份到 COS + 快照 + **演练恢复**
8. 修 CORS boot-order
9. 无鉴权 `/healthz` + `/readyz`
10. `/etc/docker/daemon.json` 日志轮转 + 每容器 mem_limit + 换 ≥8GB（建议 16GB）机型
11. 双端 Sentry DSN

### P1 — 一个月内，可运营
- 监控栈上服务器（scrape `circle_be:3000` + token + 磁盘/outbox 告警）
- 前端三处只在 401/403 清 session；WS 重连去 10 次上限
- 加 `GET /auth/im-token` 补发端点修 IM token 三死角
- Notification 补 `[toUserID, createdAt]` + unread 部分索引；friend list/activities 加分页
- CI 构建镜像推 registry 按 tag 部署（获得回滚能力）
- cron 加分布式锁；throttler 换 Redis storage
- FE feed store 用已装好的 MMKV persist 落盘冷启动缓存（无需引入 SQLite）

### P2 — 规模化（真正的高 QPS / HA）
- feed 改 fan-out-on-write（timeline 表 `[viewerId, createdAt DESC, id DESC]`）
- badge 广播去抖；WS 连接 count 走 Redis 快照
- Postgres / 对象存储迁管理型服务（TencentDB PG + COS）
- circle_be ≥2 副本 + 独立 cron worker 容器
- OpenIM 拆容器、Mongo 转 replicaSet、提 ulimit、开网关限流
- 图片/视频全量走 CDN
- k6 + WebSocket 重连风暴压测验收（1500 QPS 混合 + 1 万 WS 同时重连）

---

## 附一：关于是否引入 SQLite

**不需要。** 前端存储分层已覆盖所有场景：聊天记录由 OpenIM SDK 原生本地库管；登录态用 SecureStore + zustand persist；REST feed 只是"服务器权威 + 客户端展示缓存"，用已装好的 `react-native-mmkv` + zustand `persist` 落盘最后一页即可（P1 顺手做）。SQLite 只在"离线编辑 + 同步合并 / 本地全文搜索 / 复杂本地关系模型"时才有价值，本项目一个都没有；引入它反而增加本地 schema 迁移、缓存失效、双写一致性等高风险面。后端侧 Postgres 是正确选择，SQLite 撑不了多连接写入，方向相反。

---

## 附二：OpenIM 商业版 vs 开源版 —— 是否需要商业版

> 结论来自 2026-07-04 多智能体网络调研（5 路并行 + 对抗核实），来源为 openim.io 官方文档、openimsdk.com/enterprise 企业对比表、GitHub issues。

**功能层面结论：不需要买商业版。** OpenIM 在本项目里只承担"消息通道"这一角色，而消息通道恰好是 100% 开源（Apache-2.0）覆盖的部分。商业版的卖点你要么已自建、要么用 LiveKit 替代。

### 商业版独有功能（已核实，去营销水分）

| 商业版独有 | 核实结论 | 对 circle-im |
|---|---|---|
| **群组/多人音视频 + 视频会议** RTC 媒体栈（单会议百人视频/千人订阅/服务端录制） | ✅ verified-primary，官方文档原话"群音视频不开源" | ❌ 冗余——已用 LiveKit Cloud，且不过 OpenIM |
| **朋友圈/工作圈** moments | ✅ 确认开源服务端 0 命中 | ❌ 冗余——trace + circle-plaza 已自建 |
| **成品 UI 客户端 App** 商用授权 | ⚠️ 夸大——开源仓库其实是完整生产级 App，真门槛是 SDK 许可（见附三） | ❌ 冗余——有自建 Expo App |
| **纯 JS SDK / Web / Admin 后台源码** | ✅ verified-primary，闭源"免费用不给源码" | ❌ 冗余——有自建 NestJS 后端 + circle_admin_web |
| **组织架构**（政企通讯录） | ✅ 商业独有 | ❌ 冗余——社交 App，非企业办公场景 |
| **HA 集群 + K8s + 深度调优 + 十万级会话** | ⚠️ 能力未从开源扣留（README 就支持 K8s+集群），买的是**协调逻辑 + SLA/支持** | ⚠️ 唯一可能有价值的一类 |

**重要反向发现（别为这些付费）**：万人群（10 万成员群）、消息漫游、离线消息、云存储、多端同步、账号导入/禁用、读回执——经核实**全在开源 Apache-2.0 版**，被部分文章误列成商业功能。

### 唯一的技术天花板

商业版对本项目**唯一**可能真有价值的：**分布式 msggateway 横向扩展（一致性哈希连接/消息路由）**。维护者在 GitHub issue #3660/#2298/#3373 明确表示这个**不移植到开源版**——"请自己写代码或升级商业版"。这对应审计 P2 里"单点 msggateway、无 HA"。但现在是单 VM 测试期，远未到该拐点。

### 定价现实

OpenIM 商业版**无任何公开报价**，100% contact-sales（contact@openim.io）合同制，签约前无法预估 TCO。对比之下"买省心"的托管 SaaS 定价透明且按峰值 DAU 计费：环信 ~¥3,300–5,800/月、融云 ~¥5,500–9,500/月、腾讯云 IM 旗舰版 ~¥7,000–12,000/月（海外用户 Sendbird/Stream 贵 5–15 倍）。这些一次性买断 HA + 运维 + 审核对接，通常比 OpenIM 不透明报价更划算。

### 底线建议

**现在别买。** 继续自托管开源版，把审计 P2 里能自己搞定的做掉。三个会翻转结论的条件：
1. **规模拐点**：稳定逼近 1 万在线且需多网关节点时——但此时更可能选托管 SaaS 而非 OpenIM 商业版（先并排比价）。
2. **SDK 闭源商用许可**：见附三——这是**许可层**问题，不是功能层，且已实际触发。
3. **上架中国区 / 服务器迁大陆**：触发的是"接第三方内容审核 + 合规实体"，而 **OpenIM 商业版并不提供审核引擎**，所以这也不是买它的理由。当前 US 托管 + US 用户状态下该义务基本不绑定。

> 内容审核：开源版和商业版 OpenIM 都不自带审核引擎，无论如何都得自己用 webhook 接第三方（阿里云/腾讯天御/数美）——买商业版解决不了这个缺口。

---

## 附三：OpenIM 客户端 SDK 许可风险（上架前硬性 gate）⚠️

> 实测两处 OpenIM 客户端 SDK 的自带 LICENSE 文件确认（非营销页），对**闭源商用**是真实法律风险。

| 组件 | OpenIM SDK 依赖 | 许可证 |
|---|---|---|
| **手机 App**（circle-im，核心产品） | `@openim/rn-client-sdk@3.8.3-patch.12.3` | **AGPL-3.0-only** ⚠️ 最强 copyleft |
| 访客网页（temp-chat-web，私有 repo） | `@openim/client-sdk@3.8.3`（`src/lib/openim.ts` 直接 import） | **GPL-3.0-only** |
| — | `@openim/protocol` | Apache-2.0（无问题） |

### 含义（保守 / FSF 解读）

- **AGPL-3.0（手机 App）是主要雷点**：copyleft 触发点是"分发（conveying）"。上架 App Store / TestFlight / 发 APK = 把内嵌的 AGPL SDK 分发给用户 → 保守解读下**整个 App 构成衍生作品，须以 AGPL-3.0 授权并提供完整源码**，与闭源 App 根本冲突。AGPL 另有"网络条款"。
- **加重情节**：依赖是 `3.8.3-patch.12.3`，且 `postinstall` 的 `scripts/patch-openim-native-events.mjs` **修改了 SDK** → 分发修改版 AGPL 代码，copyleft 义务更硬。
- **GPL-3.0（网页端）** 稍弱（无网络条款），但网页 JS bundle 是分发给浏览器的目标代码，保守解读同样要求提供合并 bundle 的源码。

### 边界

非法律意见。"链接 SDK 是否构成衍生作品"存在学界争议，动态链接从宽解读存在；但保守/主流解读对闭源商用不利，而 OpenIM 卖商业授权的核心目的正是解除这条 copyleft。

### 这如何改写附二的结论

**功能上**不需要商业版；但**许可上**这是本项目最后真会付钱给 OpenIM 的唯一理由，且绑定**核心手机 App** 而非边角网页。换句话说——需要的不是商业版"功能包"，而是让闭源 App 合法内嵌 AGPL SDK 的**商业 SDK 授权**。

### 建议动作（上架前必须闭环）

1. 单独向 OpenIM 销售问"闭源商用 App 内嵌 rn-client-sdk 的 **SDK 授权费**"，别被打包进整套商业版报价。
2. 上架前找懂开源许可的**律师**确认。
3. 备选：换非 copyleft IM SDK（腾讯云 IM/融云 SDK 通常商用友好，或自封 WebSocket）——较大改动。
4. 测试期（TestFlight/内测）风险低，但**"上架前解决 SDK 授权"列为硬性 gate**。

---

*本文档结论均来自 2026-07-04 全量源码审计（29 条 critical/high 全部经独立对抗验证确认）+ 商业版对比调研 + SDK 许可实测。原始证据 digest 见会话 scratchpad。*
