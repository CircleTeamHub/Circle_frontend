# 生产就绪度审计 & 高并发容量方案

> 原审计范围：`circle-im`（Expo RN 前端）+ `circle_be`（NestJS 后端）+ `openim-docker`（IM 基础设施）
> 原审计日期：2026-07-04；本次证据校正日期：2026-07-11
> 证据规则：只有能从本分支固定版本复查的内容才称为“仓库已验证事实”。其余内容必须标为场景假设、`unavailable/unpinned` 审计输入、未决供应商问题或法律审查 gate；不得把原审计笔记、issue 摘要或容量推导写成实测结论。

### 审计输入与 provenance

| 输入 | 版本 / 可用性 | 本文可作出的声明 |
|---|---|---|
| `circle-im` 前端仓库 | verified SHA `4be235fde1032da9ac17e2757bf6cf6b3cc60e22` | 可复查该 SHA 中的前端依赖、脚本与源码事实 |
| `circle_be` 后端仓库 | `unavailable/unpinned`（本分支未包含源码或固定 SHA） | 下文后端 `file:line` 仅保留为原审计待复核项，不是本次独立验证 |
| `openim-docker` / OpenIM 服务端 | `unavailable/unpinned`（本分支未包含源码、镜像 digest 或固定 tag/SHA） | 拓扑、网关能力与配置结论必须在锁定版本后重验 |
| 私有 `temp-chat-web` | `unavailable/unpinned` | 不据此作许可证或分发结论 |
| 原始 agent scratchpad、benchmark 与生产 telemetry | `unavailable/unpinned` | “29/29”、QPS、连接数、成本等不得视为复现实验结果 |
| OpenIM 官网、商业材料、GitHub issues 与报价 | `unavailable/unpinned`（未保存带日期快照或合同） | 仅能形成待供应商书面确认的问题，不能证明功能边界、许可义务或价格 |

后文保留原审计中有定位价值的风险项，但所有依赖 `unavailable/unpinned` 输入的断言，都必须在上线决策前以固定 SHA、镜像 digest、配置快照、可复现测试或书面材料重新闭环。

---

## 0. 总结论（TL;DR）

**本分支证据不足以证明完整系统已达到生产、高 QPS 或 HA 标准。由于后端/OpenIM 输入未固定、容量未压测、HA/DR 未演练且第三方分发法律 gate 未闭环，当前生产决策为 NO-GO。**

原审计提供了有价值的风险定位，但不能预先断言修配置即可解决，也不能据此决定重构；应在固定输入上复核后按证据确定修复范围。

| 判定项 | 结论 |
|---|---|
| 生产就绪 | ❌ NO-GO，直到证据、容量、HA/DR、安全和法律 gate 闭环；此结论不授权任何第三方测试分发 |
| 高 QPS | ⚠️ 未验收（原审计推导出限流与连接池风险，但没有固定后端输入、benchmark 或生产 telemetry） |
| 高可用 | ❌ 当前描述为单 failure domain，不能算 HA；RTO/RPO 尚未由业务方批准 |

| 维度 | 原审计记录（待复核） | 原部署记录（待复核） | 当前决策 |
|---|---|---|---|
| 后端架构 (NestJS) | 分层与错误封装记录 | boot-order 风险记录 | 固定 SHA 后复核 |
| 数据层 (Prisma/PG) | 索引与分页记录 | 连接池风险记录 | query trace + 压测 |
| 水平扩展性 | replica-ready 设计记录 | Redis 缺失记录 | 多副本正确性测试 |
| 部署/可用性 | — | 单 failure domain、备份/回滚缺口记录 | 独立 HA/DR gate |
| OpenIM 消息层 | 集成层记录 | 默认密钥与暴露面记录 | 固定版本 + 多 gateway PoC |
| 前端 (Expo RN) | 本分支可复查 | session 韧性风险 | 故障场景测试 |
| 安全/认证 | 原审计安全抽样 | 邮件服务风险记录 | 固定输入安全验收 |
| 可观测性 | 埋点记录 | 生产接线缺口记录 | 监控/告警演练 |

---

## 1. 原审计的关键阻塞项（固定输入后复核，放真实流量前闭环）

> 以下优先级与 `circle_be` / `openim-docker` 的 `file:line` 来自原审计记录。由于这些输入在本分支 `unavailable/unpinned`，它们是待复核阻塞项，不等同于本次仓库验证；修复或上线 gate 必须回到固定版本重新确认。下列 QPS、并发、连接数与耗时阈值均为原审计 scenario assumptions，复现前不代表容量事实。

### P0-1 · 原审计推导：`trust proxy` 未设可能导致全站约 5 QPS 限流
Express 从未 `app.set('trust proxy')`，而所有流量经 Caddy 反代进来，于是**所有限流器把全部用户 key 到同一个 Caddy 容器 IP**。
- 证据：`circle_be/src/setup.ts:184-207,357-363`（createLimiter 无 keyGenerator，全局 300 req/min）；`docker-compose.prod.yml:99-100`（circle_be 仅 expose，不发布主机端口）+ `deploy/Caddyfile.admin:6`。
- 原审计影响推导：若上述配置成立，全局 300 req/min 会变成"全站每分钟 300 请求"（约 5 QPS）；该阈值必须在固定配置上复现。
- 修复：`app.set('trust proxy', 1)` + Caddy 覆写/清洗 `X-Forwarded-For`；staging 验证 `req.ip` 为真实客户端 IP 后再放量。

### P0-2 · 数据库连接池 = 默认 10，无获取超时
`new PrismaPg({ connectionString })` 未传池参数（`src/prisma/prisma.service.ts:39-45`），pg.Pool 默认 `max=10` 且 `connectionTimeoutMillis=0`（永久等待）。driver adapter 模式下 URL 里的 `connection_limit` 也不生效。
- 原审计影响推导：后端池可能只有 10 个 DB 连接；“约 50 并发占满”是待压测的 scenario assumption，不是实测阈值。
- 修复：`new PrismaPg({ connectionString, max: <按机型>, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })`；compose 里给 Postgres 调 `shared_buffers/effective_cache_size/max_connections`；池饱和度打进 metrics。

### P0-3 · 生产栈没有 Redis → 缓存/限流/backplane 全静默退化
`docker-compose.prod.yml` 无 redis 服务，`gen-env.sh` 不产 `REDIS_URL`，Joi 又把它标为 optional。
- 证据：`redis.service.ts:29-36`（空 URL → `isEnabled()=false`），`realtime.service.ts:232-239`（backplane 订阅直接 early-return），`setup.ts:188-195`（限流 store 退化进程内存）。
- 原审计影响推导：徽章缓存、Lua CAS 版本缓存、分布式限流、realtime 扇出可能退化成进程内存；每个 WS 连接可能触发 4 个 `count(*)`。缺少跨副本 backplane 时，跨副本 realtime 事件可能丢失，实际比例取决于副本拓扑、事件来源与连接分布，须通过多副本测试测量。
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

### P0-7 · 原审计未发现备份（RPO 未定义）
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

## 2. 容量风险顺序（修完 P0-1/P0-2 后的待验证假设）

以下顺序来自原审计的静态代码推导，并非代码 benchmark、压测或生产观测。后端与 OpenIM 输入仍为 `unavailable/unpinned`；锁定版本后应逐项设计负载测试，以测量结果决定真实瓶颈顺序。

1. **WS 徽章 count(*) 放大**：无 Redis 时每个 WS 连接跑 4 个 count（`realtime.service.ts:326-349`），每次点赞/评论触发实时 count 广播（`realtime.service.ts:403-421,437-455`）——直打 Postgres。
2. **trace feed fan-out-on-read**：`getAcceptedFriendIds` 不带 take（上限 5000 好友），`fromID IN(...)` 让 `[fromID, createdAt, id]` 索引无法按全局时间序输出，**每页 bitmap 扫全部可见 traces 再 top-N 排序 + 每页 20×20 include 树**。大好友量用户每次下拉刷新 = 全表级操作（`trace.service.ts:109-175,554-563`）。
3. **Notification count 风暴**：表只有 `[toUserID]` 索引（`schema.prisma:986-987`），unread count 每次互动实时触发，表只增不删——热门用户被点赞一波 = 最大表上的 count(*) 风暴。
4. **toggleLike Serializable 重试风暴**：`trace.service.ts:354-386` 用 Serializable 事务打单个热点计数行，热门帖并发点赞产生 P2034 中止 + 重试（每次占用池连接跨 3+ round trip）。
5. **OpenIM 网关 fd / 连接上限待测**：原审计记录称某未固定版本存在 `Setrlimit(RLIMIT_NOFILE, 10000)`；不能据此推断当前候选版本的稳定连接上限，必须固定版本后做 PoC。
6. **outbox 20 行/分钟**：好友/群同步 `@Cron(EVERY_MINUTE)` + 批量 20 + 串行（`friend-sync-outbox.processor.ts:6,32`），高负载下 OpenIM 关系落后 Postgres 无界增长——"App 里是好友但聊不了天"。

---

## 3. 容量场景：10~20 万注册、1 万同时在线（全部为 scenario assumptions / 场景假设）

本节所有 QPS、活跃率、消息 fan-out、对象大小和带宽数字都是规划用 scenario assumptions，不是实测数据、供应商承诺或容量保证。建模输入如下，任何输入改变都必须重新计算并压测：

| 建模输入 | 场景假设 | 需要补齐的证据 |
|---|---|---|
| 注册 / 同时在线 | 10~20 万注册、1 万同时在线 | DAU、峰值并发和连接时长 telemetry |
| REST 活动率 | 活跃用户每分钟 1~2 请求；朋友圈每 30s 轮询 | 按端点拆分的会话回放或埋点 |
| 聊天活动率 | 在线用户 15% 聊天、每人 15s 一条 | 消息速率分布和峰谷系数 |
| 消息 fan-out | 出站为入站 5~10 倍；示例群 100 人 | 群规模分布、在线率及离线推送策略 |
| 数据库放大 | 每个 REST 请求 3~5 次查询 | 固定 SHA 上的 query trace |
| 媒体对象大小 | 示例图片 500KB，5% 在线用户并发下载 | p50/p95 对象大小与缓存命中率 |
| 峰值系数 | 晚高峰按稳态 2 倍 | 生产 telemetry 或业务批准的保守系数 |

### 3.1 REST API（打 circle_be）

| 流量来源 | 依据 | QPS |
|---|---|---|
| 朋友圈新帖轮询 | 前端每 30s 轮询（前台就轮，不管在哪个 tab，`moments-feed.tsx:86-106`） | 10000/30 ≈ **333** |
| 自然操作（刷 feed、进个人页、点赞、切 tab refetch） | 活跃用户 1~2 请求/分钟 | 170~330 |
| 徽章/未读、token refresh、上传 presign 等 | 零碎 | 50~100 |

- 场景推导：**稳态 ≈ 550~750 QPS**；若采用 2 倍峰值系数，则为 **1000~1500 QPS**。
- 场景推导：若把 30s 轮询改成 WS 推送，理论上减少约 333 QPS，稳态约为 **250~450 QPS**；需用客户端行为与服务端压测验证。

### 3.2 长连接
在“一名在线用户各保持一条业务 WS 和一条 IM WS”的场景假设下，1 万在线对应约 **2 万条常驻 socket**。OpenIM 网关的 fd、连接路由与多网关能力不得沿用未固定版本的原审计数字；应对锁定版本做 PoC，并记录 OS/container limits 与稳定连接上限。

### 3.3 IM 消息
基于上表活动率与 fan-out 场景假设，约为 **100 msg/s 入站**、**500~1000 投递/s**。不能在没有固定 OpenIM 版本和压测的情况下断言 Kafka 或任一流水线“无压力”。

### 3.4 数据库
场景推导：1000 REST QPS × 每请求 3~5 查询 ≈ **3000~5000 DB QPS**。查询次数、耗时、锁竞争与缓存命中率必须在固定后端 SHA 上测量。

### 3.5 媒体带宽（最易忽略）
按“1 万在线、5%（500 个客户端）各拉取一个 500KB 对象，且 500 个对象都在同一个 1 秒窗口内传完”的简化场景，会得到 **约 2Gbps 数据率**。这是明确的 scenario assumption：完成时间改变会反向线性改变所需带宽（例如传输窗口加倍则平均数据率减半）；真实带宽还取决于缓存命中、对象分布和协议开销。本文没有固定云套餐或报价证据，不拿该推导替代 CDN/出口压测与供应商配额确认。

### 3.6 当前架构在此量级的结局
原审计指出 trust proxy、连接池、feed/count、网关 fd 与 outbox 等风险，但这些容量阈值尚未在固定输入上复现。**决策 gate：单节点只可作为 non-HA 的开发、staging 或容量基线；是否满足任何生产负载必须由代表性压测证明，且容量通过不代表 HA 通过。**

---

## 4. 容量拓扑与 HA 拓扑（两个独立 gate）

### 4.1 单节点容量 / staging 选项（明确 non-HA）

可用一台或单 failure domain 的环境做功能测试、容量基线和故障注入准备。它即使通过 1500 QPS 或 1 万连接等**验收提案**，仍然是 **non-HA**：主机、磁盘、网络、数据库、消息队列或网关任一单点故障都可能导致服务中断或数据丢失。不得把“容量压测通过”写成“生产 HA 通过”。

### 4.2 HA 参考拓扑要求

生产 HA 设计至少需要以下能力；云产品名称、实例规格和节点数只有在设计评审、PoC 和报价后才能固定：

- 多个独立 failure domains（例如不同可用区/机架），入口负载均衡、`circle_be` 应用节点、realtime/IM gateways 在域间冗余；滚动发布或单域故障时仍能服务。
- Kafka、MongoDB 与 etcd 采用 quorum-aware placement。投票成员不得集中在同一 failure domain；节点数、replication factor、选主/仲裁参数由锁定版本的官方文档和故障演练确认，不能把“多容器”当成“有 quorum”。
- Postgres、Redis、对象存储及 OpenIM 数据路径必须有经评审的冗余/故障转移方案；管理型服务也需验证部署域、故障转移语义和客户端重连行为。
- 备份与快照要有异 failure domain 副本、保留策略、加密/访问控制、监控告警和书面 runbook；必须按计划执行 restore drill，并保存恢复时间与数据缺口证据。
- 容量、HA 与灾难恢复分别验收：峰值负载压测证明容量；单节点/单域/依赖故障注入证明 HA；从备份恢复证明 DR。

### 4.3 上线验收提案（待业务批准，不是既有证据）

| Gate | Acceptance proposal | 通过证据 |
|---|---|---|
| 容量 | 1500 REST QPS 混合场景、1 万业务 WS + 1 万 IM WS、1 万 WS 重连风暴 | 固定 SHA/镜像 digest、负载模型、p50/p95/p99、错误率、资源水位与测试报告 |
| failure domain | 任一应用节点、gateway 或单 failure domain 丢失时，服务在批准的错误率/延迟预算内继续 | 故障注入记录、告警、自动故障转移与回切记录 |
| quorum | 逐项演练 Kafka/Mongo/etcd 的单成员与单域故障，确认不会 split-brain 且达到厂商支持的 quorum | 固定版本配置、成员分布、选主日志和读写验证 |
| 备份恢复 | 定期从隔离备份完整恢复 Postgres、Mongo、对象存储和必要配置 | restore drill 记录与校验结果 |
| RTO | **提案：≤ 60 分钟**；须由业务、运维和安全共同批准 | 从事故/演练开始到关键路径恢复的时间线 |
| RPO | **提案：≤ 15 分钟**；须按数据类型评审，聊天/账号/媒体可不同 | 恢复点、最后可验证事务/对象及数据缺口报告 |

### 4.4 成本口径

原 `$300~600/月` 只是少量计算/数据库/缓存实例的过时 scenario assumption，**不是完整 HA budget，也不是当前供应商报价**。重新估算必须基于固定区域、规格、计费周期、承诺折扣与实测用量，并明确列出 included 与 excluded。

当前成本模型明确 excluded / 不包含：load balancer、monitoring、logs、backups/snapshots、LiveKit、additional HA nodes、cross-zone/public traffic，以及 CDN/COS 请求费与出口、告警/值班、安全与许可证/法律审查成本。任何预算评审遗漏这些费用都不得通过生产 gate。

### 4.5 在该容量场景下优先验证的事项

| 事项 | 验证目标 |
|---|---|
| P0 待复核项 | 在固定后端/OpenIM 输入上确认风险与修复，不沿用 unpinned 行号作验收 |
| 轮询改 WS 推送 + 焦点 refetch 加 TTL | 测量 REST 降幅、WS 增量与断线恢复行为 |
| Notification 索引 + badge 广播去抖 | 通过 query trace 与热点负载验证 count 风险 |
| Feed fan-out 策略 | 用真实社交图分布比较 fan-out-on-read / write，而非先验认定唯一实现 |
| FE session 硬化 + WS 持续重连 | 在后端重启、超时和 token 过期场景验证不误登出、不形成重连风暴 |
| outbox / cron / throttler 多副本正确性 | 验证锁、幂等、吞吐、积压恢复和跨副本一致性 |
| 容量压测 | 使用 4.3 的验收提案；目标值由业务批准后才成为 gate |

---

## 5. 原审计记载的架构优点（后端项待固定输入复核）

- 无状态 JWT + Postgres 存储的 refresh token rotation，带重用检测（`refresh-token.service.ts:83-130`）
- 事务性 outbox + CAS 认领 + 陈旧锁恢复 + 指数退避（`friend-sync-outbox.processor.ts`）
- Redis pub/sub realtime backplane + Lua CAS 版本化缓存防陈旧覆盖（`realtime.service.ts` / `redis.service.ts:104-144`）
- MinIO presigned 直传，媒体不过 Node 事件循环（`upload.controller.ts:47-100`）
- 两个 feed 均 keyset(cursor) 分页 + 专用复合索引（`schema.prisma:769,1081-1085`）
- 全局 ValidationPipe（whitelist + forbidNonWhitelisted）+ 统一 `{code,message,data,errorCode}` 封装 + request-id 贯穿日志
- 优雅停机带 Sentry flush（`main.ts:97-121`）
- argon2id 密码/验证码哈希，账号枚举安全的登录错误，抽样 note/trace/friend/temp-chat **无 IDOR**
- 前端：单飞 token refresh（防并发风暴）、每请求 15s 超时、统一 ApiError + errorCode i18n、热列表全用 FlatList、IM 消息内存上限 200 条

> 这些条目可作为保留设计的候选清单，但不能证明多实例正确性已经解决。后端项须在固定 SHA 上复核，并通过多副本、故障注入和数据一致性测试后再作结论。

---

## 6. 修复路线图

本路线图保留原审计的候选动作，仅作为未验证的 sequencing proposal，不构成时间表、结果保证或生产资格结论。涉及 `circle_be`、`openim-docker` 和客户端 SDK 的条目须先在固定版本上复核；实施排期与 production eligibility 只有在复核成立并通过对应 gates 后才能确定。

### P0 — sequencing proposal：先处理暴露面与基础运行门槛
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

### P1 — sequencing proposal：再补齐可观测性、恢复与容量基础
- 监控栈上服务器（scrape `circle_be:3000` + token + 磁盘/outbox 告警）
- 前端三处只在 401/403 清 session；WS 重连去 10 次上限
- 加 `GET /auth/im-token` 补发端点修 IM token 三死角
- Notification 补 `[toUserID, createdAt]` + unread 部分索引；friend list/activities 加分页
- CI 构建镜像推 registry 按 tag 部署（获得回滚能力）
- cron 加分布式锁；throttler 换 Redis storage
- FE feed persistence 当前尚未实现；候选方案是用已安装的 MMKV + zustand `persist` 落盘冷启动缓存，须经固定客户端版本验证和相应 gate 验收后再决定

### P2 — 规模化容量与独立 HA/DR gate
- feed 改 fan-out-on-write（timeline 表 `[viewerId, createdAt DESC, id DESC]`）
- badge 广播去抖；WS 连接 count 走 Redis 快照
- Postgres / 对象存储迁管理型服务（TencentDB PG + COS）
- circle_be 多副本 + 独立 cron worker；节点跨 failure domains，副本数由容量和故障预算决定
- OpenIM 多 gateway PoC；Kafka/Mongo/etcd 做 quorum-aware 跨域部署与故障演练
- 文档化备份、定期 restore drill，并由业务批准 RTO/RPO
- 图片/视频全量走 CDN
- k6 + WebSocket 重连风暴压测（1500 QPS + 1 万 WS 是待批准 acceptance proposal，不是现有能力声明）

---

## 附一：关于是否引入 SQLite

**暂定不引入。** 当前 feed persistence 尚未实现；用已安装的 `react-native-mmkv` + zustand `persist` 落盘服务器权威 feed 的展示缓存只是 proposal，不是已验证实现。聊天 local history 是否由 OpenIM SDK 原生本地库完整承担，也必须针对 pinned package/version 验证其保存范围、升级行为和恢复语义。基于当前已验证需求，尚未发现必须使用 SQLite 的离线编辑与同步合并、本地全文搜索或复杂本地关系模型，因此暂定不引入 SQLite；如果这些需求、SDK 验证结论或任一 production gate 发生变化，必须重新评估该决策。后端多连接写入仍由 Postgres 承担，与客户端是否需要 SQLite 是两个独立问题。

---

## 附二：OpenIM 商业版 vs 开源版 —— 是否需要商业版

原网络调研没有在本分支保存固定 OpenIM 版本、页面快照、供应商合同或可复现 PoC，因此商业/开源功能边界与价格均为 **unresolved**。GitHub issues `#3660`、`#2298`、`#3373` 只能作为追问线索，不能证明某个开源版本缺少多 gateway、连接路由或 HA 能力，也不能证明商业版一定提供这些能力。

### 多 gateway / 商业边界决策 gate

在选择自托管开源版、购买商业支持或迁移供应商之前，必须同时完成：

1. 固定候选 OpenIM 服务端与客户端版本：源码 commit SHA、镜像 digest、Helm/chart 或 compose 版本、配置与许可证文件；未固定时保持 `unavailable/unpinned`。
2. 对该固定版本完成多 gateway PoC：至少覆盖连接分配、跨 gateway 消息路由、节点/单域故障、重连风暴、滚动升级、限流以及 Kafka/Mongo/etcd quorum 行为，并保存测试结果。
3. 若 PoC 无法回答商业边界，取得 OpenIM 的**书面确认**，逐项说明开源版和商业产品在多 gateway、HA、支持/SLA、升级路径及许可证上的权利与限制；销售口头说明不通过 gate。
4. 对相同负载模型取得可比较报价，明确 included / excluded、流量、存储、支持、迁移和退出成本。本文不提供或推断任何供应商价格。

在上述 gate 完成前，采购与功能边界结论必须保持“未决”，不能给出购买/不购买或“某功能 100% 开源/商业独有”的确定结论。

---

## 附三：第三方组件许可与二进制分发 gate ⚠️

本前端固定 SHA 可验证：`package.json` 声明 `@openim/rn-client-sdk` 范围 `^3.8.3-patch.12.3`，lockfile 解析到 `3.8.3-patch.12.3`，且 `postinstall` 调用 `scripts/patch-openim-native-events.mjs`。这些只是仓库事实；本分支没有保存该发布包的 LICENSE/NOTICE 全文、商业授权合同或律师意见，不能据此给出许可证义务或“可以闭源分发”的法律结论。私有 `temp-chat-web` 仍为 `unavailable/unpinned`。

### 不可绕过的 pre-distribution gate

**在任何第三方能够取得二进制之前**，必须完成开源许可证与商业许可证审查；这明确包括 external TestFlight、直接/商店 APK、Ad Hoc、enterprise distribution，以及任何客户、测试者、合作方或审核人员可访问的构建。内部开发设备也应受访问控制和组件清单管理，但“测试”“内测”或“未正式上架”不能自动降低或豁免分发 gate。

由具备相关司法辖区和开源软件经验的 qualified counsel / 合格律师基于实际交付物决定义务，包括但不限于：

- 固定所有第三方组件及传递依赖的精确版本、来源、LICENSE/NOTICE、修改补丁和打包/链接方式；
- 判断目标分发渠道与司法辖区下的 notice、源码提供、署名、修改披露、再许可或商业授权要求；
- 审阅 OpenIM 或替代供应商的书面商业条款，确认授权主体、产品、版本、平台、用户/设备范围、期限和终止后处置；
- 给出书面批准，或要求替换组件、取得商业授权、改变交付方式/源码策略；工程团队不得自行作最终法律判断。

发布证据包至少包含 SBOM/依赖清单、许可证与 NOTICE、补丁清单、律师/法务书面决定、对应构建 SHA，以及适用时的供应商授权文件；若供应商授权文件不适用，须由 qualified counsel / 合格律师书面确认不适用。任何适用项缺失，external TestFlight、APK、Ad Hoc、enterprise distribution 与其他第三方 binary 分发均为 **NO-GO**。

---

*本文档保留 2026-07-04 原审计的待复核风险清单，并于 2026-07-11 校正证据 provenance、scenario assumptions、供应商未决项及法律/HA 决策 gate。只有 provenance 表标为 verified 的仓库输入可在本分支直接复查。*
