# 全 App、API 与数据库分布式追踪 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 仅在用户明确选择委派后使用 superpowers:subagent-driven-development；本计划不授权自动派发。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 覆盖所有 App 页面入口、业务操作、HTTP/WebSocket、后端处理、数据库、本地存储和异步任务；对选中采样的同步操作建立可验证的父子链路，并通过用户 ID、页面模板、requestId 和安全的异步关联查到故障现场。

**Architecture:** 复用现有 Sentry React Native 与 Node SDK、Expo Router、apiClient、Winston/AsyncLocalStorage、Prisma 驱动适配器和 Prometheus 指标。页面首屏、后续用户动作、后台任务分别使用有结束边界的 trace；同步请求共享 Trace ID，异步投递使用独立 trace 与来源关联。保留 Grafana/Loki/Discord，单机测试阶段不新增服务器、Collector、Kafka、Tempo 或另一套追踪 SDK。

**Tech Stack:** Expo 55 / React Native / React 19 / Expo Router / Zustand / TypeScript；`@sentry/react-native ~7.11.0`；NestJS 11 / `@sentry/node ^10.61.0` / Prisma 7.9.1 / `@prisma/adapter-pg` / pg / Redis / Socket.IO / LiveKit。

**状态与日期：**2026-11-05，规划完成不等于代码已接通。本文件仅规划，所有实施复选框初始未完成；此前单测通过不能作为本计划分布式链路上线验收。服务器配置事实沿用本会话最近一次只读核查，不把工作区代码等同于线上构建。

## 1. 范围和完成定义

**覆盖全部页面**意味着每个路由有导航/退出信号、首屏就绪或取消边界、错误关联，且该页可触发的业务动作已归入下面的功能矩阵；不是强制每个页面都访问 API/数据库。纯文本协议页、选择器、本地偏好页也必须分类，不制造不存在的数据库 span。

**覆盖全部功能**包括路由之外的弹层、批量操作、长按菜单、返回手势、后台恢复、深链、推送、录音、媒体、聊天重试和后台任务。生命周期事件可以只保留安全诊断；有结果/耗时的业务动作创建 trace；不得为每个滚动像素或输入字符创建 span。

**完整同步链路验收：**同一次已采样操作，App action/page → HTTP client → backend HTTP server → service step（确有必要时）→ DB adapter span，Trace ID 相同，parent span ID 正确，不串用户/请求，真实时间测量，跨项目可在 Sentry 检索；不承诺所有失败都拥有完整 trace，未采样、离线、进程崩溃或配额丢失仍可能缺失。

**异步完整性：**聊天连接不是所有消息的永久父 span；队列投递、后台重试、通知到达/点击、LiveKit 外部服务也不是一个无限延长的同步调用。创建独立 trace，能证明关联则附来源 trace/span link，不能跨第三方观测的部分明确标为外部边界。

**快照：**249 个可导航/特殊路由 TSX 文件（排除 `_layout.tsx` 和 `+html.tsx`），130 个去重后的功能入口引用，19 个 features 目录，43 个 API 函数模块共 272 个导出函数。后端 57 个 Controller；398 个单行 HTTP 装饰器声明为初步扫描数，包含管理端，不能当成最终端点总数。实施时用 TypeScript AST 识别多行装饰器、别名、组合装饰器和版本前缀，生成正式契约。

**仓库路径：**前端 `C:/Users/93256/Desktop/WIndNote/Circle_frontend`；后端基线 `C:/Users/93256/Desktop/WIndNote/circle_be_main`。下文 F/、B/ 分别相对此二根目录。后端业务 `B/src/trace/` 是业务模块，不是遥测目录，禁止按名字误替换。管理后台独立 Web UI 不在 App 路由范围；它调用的后端 Controller 获得同样 HTTP/DB 基础追踪，后台 UI 追踪另有独立边界。

## 2. Global Constraints

- 单台测试服务器是已接受约束；当前目标是利用现有 Sentry 接通链路，不构建大型监控集群。
- 用户明确允许 Sentry 使用内部 `AuthUser.id` 排障。只在错误/事务身份字段关联；不把 userId、requestId、traceId、原始 URL 加入聚合指标标签。
- 禁止上报密码、token、验证码、cookie、认证头、聊天/笔记正文、昵称/手机号/邮箱、剪贴板、精确坐标、媒体地址、SQL 原文/绑定参数、请求/响应正文；不启用 Replay、截图、View Hierarchy。
- 固定操作名、路由模板和枚举白名单；动态 ID、搜索词、邀请 code 不得进入 span 名、事务名、fingerprint 和标签。已有脱敏器保持最后一道过滤，不因为要看链路而关闭。
- requestId 保持每次 HTTP 尝试的 UUID；Sentry traceId 为另一种语义/格式，禁止用 `traceId=requestId` 冒充分布式追踪。
- 前端身份在登录/退出/切号时同步切换；旧会话异步任务不得写入新用户现场。后端身份必须来自认证结果，不信任请求体和 baggage 中的用户声明。
- 只向当前配置的第一方 API 精确 origin + API path 边界传播 `sentry-trace`、经过白名单处理的 `baggage`。不传播到对象存储预签名 PUT、地图、CDN、LiveKit、Sentry ingest、邮件/推送供应商或任意 WebView URL。
- 保持原有重试、幂等、超时、事务、缓存及用户结果；埋点不能重发支付/转账/消息/发布等非幂等业务。取消、权限拒绝、离线等待与技术失败分别标记。
- 不全局修改 fetch/Promise、不使用全局 currentAction 单例绑定所有并发请求；按操作/请求快照上下文，跨 await、队列、回调显式传递必要上下文。
- 不同时启动第二套 Node OpenTelemetry provider；不同时用手动 adapter span 和 pg/Prisma 自动 span 重复包同一查询。
- 本轮只新增计划文件。执行前在隔离 worktree 操作；保留当前其他未提交更改。PR 默认 ready for review，按可独立验收的任务提交。收尾结束自己启动的测试/调试进程，保留用户隧道与业务服务。

## 3. 当前阻塞点和已有能力

| 位置 | 已有能力 | 需要完成 |
| --- | --- | --- |
| F/app/_layout.tsx、F/src/observability/sentry.ts | 导航集成、用户身份、最近页面历史、错误/事务/Span 脱敏 | 第一方传播；首屏与动作边界；可读且安全的子 span 名 |
| F/src/observability/tracing.ts | 固定动作根 span；结束时记录耗时指标与本地诊断 | 目前 `parentSpan:null`，不能简单用于所有子步骤；上下文隔离、动作表扩展、避免重复记指标 |
| F/src/services/api/client.ts | 请求 ID、401 刷新/重试、请求指标、诊断与去重 | 每次尝试关联到正确 HTTP span，刷新请求区分，解析/映射边界，CORS |
| B/src/main.ts、B/src/startup-instrumentation.ts | 在主启动文件前部初始化错误聚合；已有进程兜底和关闭 flush | 真实验证 HTTP/Express 插桩加载顺序，不能只认源码 import 顺序 |
| B/src/logging/error-aggregation.service.ts | 脱敏、可选 Sentry、事务允许列表；后端性能默认关闭 | 启用受控性能采样；保留 trace 关系与安全子 span；请求级身份 |
| B/src/logging/request-context.ts、request-logger.middleware.ts | AsyncLocalStorage、UUID requestId、日志上下文 | 现有 `traceId` 是 requestId 别名，迁移到真实 traceId 并保留旧日志可查询性 |
| B/src/prisma/prisma.service.ts、B/src/logging/database-observability.ts | Prisma 7 的 pg adapter，包括事务 queryRaw/executeRaw；池指标 | 在现有边界创建无 SQL 的 DB span；当前 early return 受 performanceLogOn 控制，追踪不能随日志关闭而停用 |
| 服务器现状 | Prometheus/Grafana/Loki/Alloy/Alertmanager、既有 Discord 频道 | 最近核查后端未启用 Sentry；部署前再次读开关并检查项目/额度，不能把本地配置当线上状态 |

## 4. 链路边界、数据契约与采样

### 4.1 生命周期

| Trace / 子步骤 | 开始 | 结束 | 状态 |
| --- | --- | --- | --- |
| 页面首屏 | 导航开始/激活（SDK 已提供的事务复用） | 初次数据、缓存或空态准备好且关键内容布局可用；静态页为首次布局 | ok / failed / cancelled / deadline |
| 后续用户动作 | 业务动作提交；用户输入/长时间选择文件不包含在网络 span | 服务确认并完成该操作要求的本地状态更新；批量报告部分成功 | success / failed / cancelled / partial |
| HTTP client | 单次网络尝试实际开始 | response body 读取结束；解析单独子步骤（避免与自动 HTTP 重叠重复计时） | timeout/network/http/api-code/body-read/invalid-json |
| HTTP server | 收到并接纳合法追踪上下文 | response finish / close / abort，error filter/interceptor 只负责一次错误报告 | 与实际响应/取消对应 |
| DB | 进入 adapter queryRaw/executeRaw | await resolve/reject；事务 BEGIN/COMMIT/ROLLBACK 边界单列 | ok / error / cancelled |
| 聊天发送 | 提交逻辑发送操作 | 收到持久化 ack 并对本地消息状态完成 reconciliation；排队、传输、等待 ack 分段 | 排队取消与失败区分 |
| 上传 | 准备确定的上传动作 | 签名、实际传输、业务确认完成 | 权限/用户取消不当作技术故障 |
| 通话 | 发起/接听确认 | 房间连接成功或失败；通话结束是单独短事件/操作 | 不把数小时通话录成一个持续事务 |
| 后台任务 | 每次运行/每次消费开始 | 本次执行完成或失败；重试是另一次 attempt | run/attempt/result 独立 |

页面首屏不能因为聊天常驻连接/推送订阅长期不结束。新动作不要继续挂到一个已经结束的首屏根 span 下；通过用户、route 模板与必要的 span link 关联，再让动作内同步的 API/DB 使用同一 trace。

### 4.2 公共接口（拟在原模块实现，不建通用埋点框架）

```ts
// F/src/observability/tracing.ts；ActionName/StepName 取固定对象的 keyof。
import type { Span } from '@sentry/core';
export interface ActionTrace {
  readonly span: Span | undefined;
  readonly sessionEpoch: number;
}
export function withActionTrace<T>(
  name: ActionName,
  task: (trace: ActionTrace) => Promise<T>,
): Promise<T>;
export function withChildTrace<T>(
  trace: ActionTrace | undefined,
  step: StepName,
  task: () => Promise<T>,
): Promise<T>;
// F/src/services/api/client.ts 的 RequestOptions 增加可选 trace?: ActionTrace。
// SDK 身份、Span 对象、上下文不进入持久化状态、路由参数、MMKV、消息正文。
```

`ActionName` 定义为功能域矩阵固定动作对象的键；`StepName` 定义为有限子步骤对象的键（prepare/cache/localDb/http/bodyRead/parse/upload/ack/reconcile）。实现时两表与最终脱敏器共用同一份声明，不从任意字符串扩展。

`withActionTrace` 必须原样返回/抛出 task 结果；实际单调时钟测量；finally 只结束一次；追踪失败不改变业务；同一动作只记一次操作指标。沿用现有 startOperationSpan 调用点的兼容签名。快照中的 tracing.ts 定义 chatSend/chatConnect/mediaUpload；metrics.ts 另已允许 noteCreate/noteUpdate/noteCollect，笔记耗时还有并行工作，执行前核对其最终落点，不能重复造根 span/指标。

前端 SDK 对 async context 的实际能力由 Task 1 在 RN/Web 验证。apiClient 在入口、首次 await 前快照父上下文；跨 await/状态队列的业务调用使用显式 `trace`，不能仅用 withActiveSpan 包一个 async 函数就假设全部 await 自动隔离。HTTP span 的 headers 必须来自这次 HTTP 子 span，不能复用上一个请求的 Span ID。

后端使用已有 SDK 的 HTTP 上下文续接；后台/WS 消费通过 `continueTrace` + 作用域隔离，所有接口调用前以安装版本类型声明验证签名。业务 StepName/ActionName 是有限值，不从用户字符串构造。

### 4.3 字段允许列表

允许：真实 trace_id/span_id/parent_span_id、归一化 route、固定 operation/step、method、status、outcome、平台、environment/release/dist、持续时间、计数、cache_hit 布尔值、response_source 枚举、requestId（事件/日志关联）、经认证的内部 user.id（事件身份）。

DB 只允许固定 `db.queryRaw`、`db.executeRaw`、transaction 生命周期、数据库类型与时间；不发送 SQL/参数/DSN/错误正文，不把现有 queryFingerprint 当成 query 原文。adapter 耗时包含驱动往返，非事务查询可能包括连接池等待；未单独测量时不得命名成纯 PostgreSQL 执行耗时。池等待量继续看现有 Prometheus 指标。

HTTP `sentry-trace` 入站验证 32 位十六进制 trace ID、16 位 span ID 与合法 sampled 状态；使用 SDK 解析器。第一方 baggage 仅保留 SDK 续接采样所需且已评审字段，拒绝任意用户字段；限制长度的边界方案在 Task 1 契约测试中固定（初始验收上限 trace header 256 bytes、baggage 2048 bytes），不重复在 service 层校验。无效/缺失上下文以正常新 trace 处理，不能让监控头导致业务 500。

### 4.4 采样和预算（以下为拟验收目标，不是已测结论）

- 生产根 trace 基础采样维持 5%；后端合法入站上下文继承父采样决定，不各自独立掷一次 5% 导致链路断裂。后台新根默认 5%；错误 issue 捕获策略独立。
- 后端采样配置为0是强制性能关闭：sampler先检查关闭状态再决定是否继承父sampled，加入parent sampled=true且服务器为0的测试，确保回滚不被上游决定绕过。
- 指标独立于 trace 采样；不把去重后的 issue 数当精确失败次数。不承诺 head sampling 保留全部慢/失败链路，也不在本计划新增 tail-sampling 集群。
- 预生产仅对受控测试会话的短时验收开到 100%，通过测试环境配置实现；不能允许普通客户端一个调试头强制生产全采样。
- 客户端 sampled 标志不是权限凭据；后端续接仍受组织/项目预算和服务端采样上限约束。触及上限时允许缺失部分性能链路并明确记录限流，不为“完整”绕过安全与成本限制，不自建额外限流服务。
- 页面/操作不按每行列表、每个字符、每个 websocket 心跳建 span。一次批量业务记录概要 + 受控子步骤，初始手动子 span 上限 50/动作；超过记录 bounded counter，不延长业务或扩大 payload。
- 保留现有操作超时与取消语义；导航未完成、路由卸载、会话变更均关闭属于本次操作的资源，不新增遥测引起的业务超时。SDK 发送与 flush 不进入每次请求关键路径。
- 基线与启用后同机同数据各至少 5 轮：页面首屏/后台 API p95 增幅目标不超过 5%，业务进程 CPU 增量目标不超过 3 个百分点，空闲时不持续增大遥测内存；超出先降噪/采样/修实现再决定预算，不把短测噪声当性能保证。

## 5. 功能域覆盖矩阵

每行都要求：首屏（适用时）、读取/刷新/分页/空态、主要写入动作、用户取消、权限拒绝、后端失败、本地失败、卸载和切号。单纯打开弹层/切换本地选择通常记录诊断，确认提交才创建动作；不得上传输入内容。

| 任务 | 功能域与全部主要操作 | 主要入口（F/） | 后端边界（B/src/） | 完成边界与特殊验收 |
| --- | --- | --- | --- | --- |
| T7 | 登录、注册、找回密码、设备验证、引导、邀请链接、添加/切换账号、登出、token 刷新 | features/auth/screens、hooks/use-auth.ts、services/auth/session.ts、stores/authStore.ts | auth/、user/、admin-user/session-revocation* | 认证完成+必要本地会话建立；401 刷新单列，失败不关联旧账户 |
| T8 | 消息主页、分组、临时聊天、找人/搜索、会话冷启动、本地历史、增量同步、离线队列、已读/送达/输入/在线状态 | features/messages、chat-core/client.ts、send-queue.ts、socket-manager.ts、sync.ts、local-db.ts / .web.ts、features/chat/chat-detail/hooks | chat/chat.gateway.ts、chat.service.ts、temp-chat/、realtime/ | 消息首屏可用≠socket永久连接；发送至服务 ack，不冒充接收者已读；typing/presence 只聚合不逐条追踪 |
| T8 | 文本/表情/语音/图片/视频/位置/笔记/名片/转账卡片发送、回复、转发、编辑、撤回、回应、清空、搜索历史、批量转发、收藏消息、背景与群通知 | features/chat/screens、chat-detail/hooks、components/bubbles、chat-core/protocol.ts | chat/、conversation-group/、coin/、collection/ | 每次尝试与逻辑提交分开；已有 deliveryId 幂等不改；错误只上报一次 |
| T9 | 联系人、好友动态、分组标签、新朋友、申请与接受/拒绝、用户资料/权限/备注/标签、拉黑、推荐/举报 | features/contacts、social、user、services/api/friends.ts、profile.ts、privacy.ts | friend/、user/、privacy/、moderation/ | 页内读取与确认写入；不上传昵称、备注、搜索词、举报文本 |
| T9 | 群/圈子入口、创建/加入/邀请/退出、资料编辑、公告、成员搜索/管理、审批/审核、圈子席位/通知/帖子/分享卡 | features/groups、discover、chat/screens/GroupManageScreen.tsx、EditGroupNoticeScreen.tsx | group/、circle/、circle-invitation/、chat/group-admission*、group-expansion/ | 成员关系/通知扇出后台另起 trace；部分成功可见；无权限为正常拒绝 |
| T10 | 广场、动态、帖子详情/创建/编辑/删除、评论/点赞、报名/管理报名、筛选/城市、个人动态、选笔记、分享 | features/discover、social、explore、services/api/moments.ts、plaza.ts | circle-plaza/、trace/、like/、geo/ | 列表首屏、刷新、分页各区分；发布到服务确认，不跟随用户停留持续计时 |
| T10 | 笔记列表/分组、详情、编辑/创建、草稿、回收站恢复/删除、上下架、排序、录音、音视频、导入/导出、发送/收藏；收藏列表、打开/播放、选择模式/批删/返回 | features/notes/screens、components、utils/note-submission.ts、note-draft-save-queue.ts、note-media-upload.ts；features/profile/screens/CollectionsScreen.tsx | note/、collection/、upload/、note/note-status-fanout-outbox.processor.ts | 本地草稿落盘与远端保存分开，乐观更新后服务确认单列；录音结束/释放异常和返回回归 |
| T11 | 我的主页、头像/资料字段编辑、图标、分享、设置全部子页、黑名单、外观、自动回复、通知/隐私/系统权限、存储分析/清理、密码/邮箱/安全码、设备撤销、注销 | features/profile/screens、components/settings-detail.tsx、hooks/use-storage-actions.ts；services/cache/clear-app-cache.ts | user/、privacy/、auth/、icon/、support/ | 纯偏好页只计本地读取/写入；清缓存不清掉活动 trace/账号关联；危险操作测试账号验收 |
| T11 | 钱包、积分/信用、商城、会员/规则、靓号购买/续费/切换、头像框、扩容、客服/客服成员、公告详情、版本/协议/许可 | features/profile/screens；services/api/coin.ts、credit.ts、mall.ts、membership.ts、fancy-number.ts、avatar-frames.ts | coin/、credit/、mall/、membership/、fancy-number/、avatar-frame/、group-expansion/、support/、notification/ | 钱包真实账务确认与UI刷新分开，不重试写入；静态说明无 API/DB span；不采卡号或金额明细 |
| T12 | 通知列表/筛选/已读/全部已读/报名提醒、系统推送、横幅点击、深链路由、冷启动通知、token注册/撤销、声音/触觉设置 | features/notifications、components/app/session-bootstrap.tsx | notification/、notification-push-outbox.processor.ts、chat/chat-push.service.ts、call/call-push.service.ts | 到达/点击/路由就绪是独立阶段，不假设OS一定回调；推送SDK正文不进遥测 |
| T12 | 语音/视频/群通话，邀请、接听/拒绝/取消、重连/掉线、音频路由、权限、后台/来电、房间关闭 | features/call、features/chat/chat-detail/hooks/use-chat-call.ts | call/、call/livekit.service.ts、call/call.webhook.controller.ts | 建连结束于房间ready；媒体质量走聚合指标；云LiveKit内部只标外部边界，不伪造服务端span |
| T12 | 文件选择/拍摄/压缩/录音、本地持久化、预签名、PUT、确认/重试、下载/保存/分享、位置选择/地图/地理编码、二维码生成/扫描/登录/邀请/接受 | services/api/upload.ts、services/media、utils/save-image.ts/.web.ts、features/location、features/qr、features/messages/screens/ScanScreen.tsx | upload/、geo/、qr/、circle-invitation/ | 第三方URL无传播头；App内父子span可有，第三方内部无span；不上传路径/文件名/二维码内容/坐标 |
| T13 | 助手会话/流式回复/订阅提醒、悬浮入口、搜索、App启动与前后台、OTA检查下载激活/健康回执、模块加载、加密存储/迁移、后台重连 | features/assistant、features/search、features/app-update、storage/、app/_layout.tsx、components/app/AppOperationsHost.tsx | assistant/、assistant-alert-delivery.processor.ts、app-operations/、realtime/ | 流式请求首token/完成分开；不采prompt/回复；本地存储只记类别/时间；OTA分新release验证 |
| T14 | 所有 Controller（含无App页的管理/开放入口）、定时作业、outbox、邮件/推送/对象存储/Redis调用、管理操作后台消费 | services/api/ 全模块与后台触发链 | 57 个 Controller、所有 *.processor.ts、metrics/tracked-cron.decorator.ts、redis/、外部服务入口 | HTTP基础统一覆盖；定时无用户scope；审计/业务事实不由遥测替代；独立Admin UI不冒充已覆盖 |

## 6. 实施任务与独立验收

顺序：T1 → T2/T3/T4 → T5 → T6 → T7…T14 → T15 → T16。T2～T4 可以分支独立开发，但串联验收前必须合并兼容；此依赖图不是自动委派授权。每项包含测试、最小改动、验收后提交；不能只合入初始化而宣布全栈完成。

### T1：全入口清单、版本与上下文隔离契约

**Files:** Create F/scripts/check-tracing-coverage.mjs、F/test/tracing-coverage.test.js、F/test/tracing-context.test.js；Modify F/docs/observability.md；Test B/src/startup-instrumentation.spec.ts。

**Consumes:** 本文件附录路由/共享入口/API/Controller基线。**Produces:** 路由/组件/action manifest 的正式 AST 检查，确定当前 SDK 的 context continuation/async 行为；不更换SDK版本。

- [ ] 写基线漂移测试：新增一个路由、API导出、Controller多行装饰器但未登记时应失败；删除路由后也要提示清单过期；记录静态页/重定向特殊分类。
- [ ] 用安装包 SDK 的真实 Scope/Span 类型写契约测试：两个交错 Promise、setTimeout、401 刷新和队列恢复，A 操作的后代不能挂到 B；采样false上下文仍能安全传播；SDK未初始化时任务结果不变。
- [ ] 运行 `node --test test/tracing-coverage.test.js test/tracing-context.test.js`，先看到预期失败；把最小 manifest 校验实现到 scripts，验证通过。手动导航 SDK 自动 HTTP 和显式 apiClient span 的选择，在同一请求必须只有一份 client span。
- [ ] RN Hermes、Android/iOS、Web各做短 PoC；不能用纯 Node VM 的 async 行为替代 RN 结论。不能证明自动隔离的回调路径统一显式传 ActionTrace，不依赖全局可变current span。
- [ ] 记录实际 SDK API 签名、JS/CJS加载方式与缺失模块结果；若 pg/Prisma 自动插桩不兼容，采用 T4 既有 adapter 手动 span，默认不新增 @prisma/instrumentation。
- [ ] 更新文档并仅提交本任务文件。退出自己启动的PoC进程。

### T2：第一方传播、CORS 与请求采样续接

**Files:** Modify F/src/observability/sentry.ts、F/src/services/api/client.ts、F/src/constants/config.ts（如需显式API解析只在原入口）、F/test/api-client-refresh-session.test.js、F/test/sentry-tracing.test.js；Create F/test/tracing-propagation.test.js；Modify B/src/main.ts、B/src/main.spec.ts；检查 B/deploy/Caddyfile.admin 和实际活动 Caddy 配置，不凭文件名认定代理行为。

**Consumes:** T1 隔离结论。**Produces:** 单次 HTTP 上下文快照与第一方头传播，Web预检通过，后端支持但不信任这些身份字段。

```ts
// 新测试的核心断言（fixture 的 API origin 必须来自测试配置，不访问生产）
assert.ok(firstPartyRequest.headers['sentry-trace']);
assert.equal(storagePut.headers['sentry-trace'], undefined);
assert.equal(evilLookalikeOrigin.headers.baggage, undefined);
assert.notEqual(firstAttempt.requestId, retryAttempt.requestId);
assert.equal(firstAttempt.traceId, retryAttempt.traceId);
assert.notEqual(firstAttempt.spanId, retryAttempt.spanId);
```

- [ ] 先覆盖 exact origin、端口、路径边界、伪装域名、query、绝对/相对URL、未初始化SDK、父sampled=0、非法传播头；运行新测试确认失败。
- [ ] 比较 `URL.origin` 与已配置 API origin，匹配 API 路径边界；禁止简单 `startsWith('https://api...')`。所有重试各创建一个 HTTP 尝试 span，trace 归属稳定。外部签名 PUT 和第三方SDK不注入；API不得跨origin重定向携带这些自定义头，测试3xx与预签名链路。
- [ ] CORS allowedHeaders 仅新增 `sentry-trace`、`baggage`（若实际采用 traceparent，同任务显式列入并测试），不改既有来源限制与凭据策略；不要把响应暴露头与请求允许头混用。
- [ ] 初始先保留 SDK 自动 HTTP 在其他路径的行为，但 apiClient若手动包span应禁用其重复自动span；不得复制一个请求变两个网络请求。
- [ ] 前端命令 `node --test test/tracing-propagation.test.js test/api-client-refresh-session.test.js test/sentry-tracing.test.js`；后端 `npx jest --runInBand src/main.spec.ts`。真实Web检查 OPTIONS+GET；iOS/Android检查只在API出现传播头，不输出头值到普通日志。
- [ ] 提交跨仓兼容改动；先部署兼容CORS的后端，再发客户端。

### T3：后端 HTTP trace 与日志、用户关联

**Files:** Modify B/src/startup-instrumentation.ts、B/src/logging/error-aggregation.service.ts、B/src/logging/request-context.ts、B/src/logging/request-logger.middleware.ts、B/src/logging/winston-options.ts、B/src/config/env.validation.ts、B/src/logging/log-sanitizer.ts；Create B/src/logging/distributed-tracing.spec.ts；Extend B/src/logging/http-observability.spec.ts、request-context.spec.ts、aggregation-privacy.spec.ts。

**Consumes:** T2 入站头。**Produces:** 一次HTTP server span，真实 requestId/traceId/spanId，服务端认证身份，统一安全日志关联。

```ts
expect(server.traceId).toBe(client.traceId);
expect(server.parentSpanId).toBe(client.spanId);
expect(log.requestId).toBe(response.headers['x-request-id']);
expect(log.traceId).not.toBe(log.requestId);
expect(capturedPayload).not.toMatch(/password|private-chat|Bearer\s/);
```

- [ ] 在隔离子进程中先写加载顺序测试，真正发本地HTTP并验证server span，不只断言import文本；关闭DSN/provider仍能正常启动和响应。
- [ ] 复用 startup-instrumentation 的单次初始化，确保先于Express/Nest/pg加载；保留应用已有fatal/unhandled guards，不再挂第二份异常handler。若实际编译输出提前加载模块，用启动预加载入口修正，并测试start/start:prod/测试模式三种路径。
- [ ] 通过 SDK 隔离作用域关联请求；认证成功后仅设置经验证内部用户ID，匿名请求与定时任务无用户；并发A/B/匿名请求测试不串身份。不在全局执行setUser代替请求scope。
- [ ] RequestContext 保留UUID requestId；增加真实Sentry traceId/spanId 可选字段；无SDK时只保留requestId，不再写假的同值traceId。日志向后兼容旧历史查询，新增字段允许列表并更新Loki查询说明。
- [ ] sampler 继承合法第一方父决定，后台无父按5%；不把未经校验的任意baggage当成权限/用户/生产强制采样开关。provider+dsn+采样可分别关闭性能而保留错误。
- [ ] 执行上述4个spec；故意返回401/403/500/取消和并发慢请求，断言HTTP结果与原逻辑一致、span只结束一次。
- [ ] 提交后端独立PR与安全配置说明，不写入DSN密钥/上传token。

### T4：Prisma 7 / pg 与 Redis、外部依赖子步骤

**Files:** Modify B/src/logging/database-observability.ts、B/src/logging/database-observability.spec.ts、B/src/prisma/prisma.service.ts、B/src/prisma/database-observability.integration.spec.ts；Create B/src/logging/tracing.ts、B/src/logging/tracing.spec.ts；Modify B/src/redis/redis.service.ts 与现有外部服务统一入口（实际文件由T1依赖清单登记，不能遍历每个service重复包DB）。

**Consumes:** T3 请求scope。**Produces:** DB查询/事务及必要依赖子span，且无SQL、Redis key/value和第三方地址。

```ts
expect(dbSpan.traceId).toBe(serverSpan.traceId);
expect(dbSpan.parentSpanId).toBe(serverSpan.spanId);
expect(await observedAdapter.queryRaw(query)).toEqual(originalResult);
expect(JSON.stringify(envelope)).not.toContain(query.sql);
expect(traceWithPerformanceLogOff.dbSpans).toHaveLength(1);
```

- [ ] 覆盖 queryRaw、executeRaw、事务连接、提交、回滚、错误、performanceLogOn=false、SDK关闭、重入；先红再改。不得使用Prisma 7已移除的 `$use`/`$metrics`。
- [ ] 将 tracing 是否启用与 performanceLogOn 分开，复用原adapter包装而非重复代理多层；把 `await run()` 放在span finally生命周期内，span异常不能替换DB结果/原异常；确保方法this绑定及事务语义不变。
- [ ] 默认禁用会重复或采SQL的 pg/Prisma 自动追踪；只传固定操作名、数据库类型、耗时与状态。连接池总等待量继续使用既有指标；未测得单次pool acquire不伪造其span。
- [ ] Redis统一入口按命令类别追踪，不采key/value；邮件、推送、对象存储、助手模型调用只做安全外部边界span，不传播内部trace头到第三方。
- [ ] `npx jest --runInBand src/logging/database-observability.spec.ts src/logging/tracing.spec.ts src/prisma/prisma.service.spec.ts`；集成测试使用隔离测试Postgres，事务回滚后核对数据库无多写，SQL含secret哨兵但envelope无secret。
- [ ] 提交；不改数据库业务schema与超时来迎合观测测试。

### T5：动作/页面追踪核心与最终脱敏

**Files:** Modify F/src/observability/tracing.ts、metrics.ts、sentry.ts、F/app/_layout.tsx、F/src/observability/RouteErrorBoundary.tsx；Create F/src/observability/use-page-trace.ts、F/test/page-tracing.test.js、F/test/action-tracing.test.js；Extend F/test/sentry-tracing.test.js、sentry-user-journey.test.js、sentry-readable-errors.test.js、sentry-metrics.test.js。

**Consumes:** T1隔离与T2～4同步链；**Produces:** 4.2接口、首屏ready/error/cancel绑定和固定操作注册表；同名数据不能重复统计。

```ts
const result = await withActionTrace('note.save', async trace => saveNote(input, { trace }));
expect(result).toBe(serverResult);
expect(actionMetrics).toHaveLength(1);
expect(request.traceId).toBe(action.traceId);
expect(spanPayload).not.toMatch(/private-note|private-user-in-route|signed-url/);
```

- [ ] 注册有限 ActionName/StepName 表；用真实单调时钟替身验证时长来自start/end差值，成功/失败/取消/部分成功；未采样仍记录指标，SDK失败结果不变。
- [ ] 首屏复用已注册navigation transaction；`usePageTrace` 接收固定页面键与ready/error布尔状态，返回/失焦/卸载清理；cache命中、合法空列表算ready，后台refresh不重置首屏。
- [ ] 页面停留期间的后续写入使用短action根，不能把nav idle span撑数分钟；异步链显式传trace。旧会话结束后不再挂新用户/新页面现场。
- [ ] 前后端 sanitizer 保留合法关联ID、时间、固定子span名/固定op、HTTP方法和安全路由、DB类别；未知description仍丢弃，不开放任意SQL/URL。对final envelope做断言，不能只测手写context。
- [ ] `node --test test/page-tracing.test.js test/action-tracing.test.js test/sentry-tracing.test.js test/sentry-user-journey.test.js test/sentry-readable-errors.test.js test/sentry-metrics.test.js`；typecheck与lint。
- [ ] 提交公共能力，现有note/chat/media调用点测量次数不增加；API 5xx只保留一次错误事件。

### T6：全路由首屏与公共列表交互

**Files:** Modify 附录A的全部路由对应共享入口（优先在130个canonical feature入口接一次，复用到所有路由）；Modify F/src/components/ui/nav-header.tsx、F/src/components/app/floating-tab-bar.tsx；Create F/test/page-tracing-coverage.test.js；Extend F/src/observability/RouteErrorBoundary.spec.tsx。

**Consumes:** T5 hook + T1 manifest。**Produces:** 249路由全分类、首屏覆盖与焦点/返回信号；无网络页不制造HTTP span。

- [ ] 为每类页面先写一个行为回归：网络页、缓存页、静态页、弹层选择器、重定向、404、动态[id]、Web分栏；脚本测试任一新增路由无分类时失败。
- [ ] 按附录路由逐个勾选canonical接入；列表加载/刷新/分页分别固定操作名和计数，不记录列表数据；导航模板包含[id]占位不含真实参数。
- [ ] 返回按钮、系统返回/手势、tab切换、深链落页都能结束旧首屏/操作；返回收藏页原生资源释放回归必须保持通过。
- [ ] 运行 `node --test test/page-tracing-coverage.test.js test/sentry-route-segments.test.js` 及 `npm run test:behavior -- --runInBand src/observability/RouteErrorBoundary.spec.tsx src/features/profile/screens/CollectionsScreen.spec.tsx`。
- [ ] 逐路由登记“静态分类通过/行为测试通过/实机通过”，不能把扫描出文件存在当作首屏已测。按功能域小PR提交，完成本任务后仍不能宣布所有功能写入已覆盖。

### T7～T13：按功能域实施业务动作（每个任务独立红绿/评审）

下表的Files均为现存功能目录/公共入口；确切canonical页面在附录B，路由在附录A；API导出在附录C。每个任务都必须在自己的功能目录补/扩 `.spec.tsx`，并添加表中的Node契约测试，不用只有源码正则的检查替代行为测试。

| 任务 | Files / Test | 需要落地的固定动作与测量边界 | 独立验收 |
| --- | --- | --- | --- |
| T7 认证与会话 | F/src/hooks/use-auth.ts、services/auth/session.ts、features/auth/screens、stores/authStore.ts；Extend hooks/use-auth.spec.tsx；Create test/auth-tracing.test.js | auth.login/register/recover/verify/switch/logout；凭据提交→API→本地会话；刷新为auth.refresh子链，不记录输入 | 成功、401/403、离线、验证码过期、SecureStore失败、A任务晚返回B账号；断言用户和trace不串 |
| T8 消息、聊天和本地存储 | F/src/chat-core/{client,send-queue,socket-manager,sync,local-db,local-db.web,protocol}.ts、features/chat、features/messages；B/src/chat/{chat.gateway,chat.service,chat.types}.ts、B/src/realtime/realtime.gateway.ts；Create F/test/chat-distributed-tracing.test.js、F/test/local-db-tracing.test.js、B/src/chat/chat-tracing.spec.ts | chat.open/send/forward/edit/revoke/react/read/history/sync；排队/准备/上传/传输/ack/本地reconcile分段；SQLite仅固定query类别；握手不作为所有消息永久父级 | 未升级对端可继续通信；ack超时、断线重试、重复ack、批量部分成功、后台恢复、并发消息、Web多tab、SQLite失败；一逻辑发送一操作指标 |
| T9 联系人/用户/群圈管理 | F/src/features/{contacts,user,groups,discover,social} 对应管理页面及服务API；Create test/social-management-tracing.test.js；Extend groups/GroupEntryScreen 现有测试 | friend.request/accept/reject、profile.edit、group.create/join/invite/manage/leave、circle.edit/review；绑定服务确认，后续fanout独立 | 权限拒绝、已是成员、邀请过期、取消、并发列表刷新、部分成员成功；HTTP与DB关联且无昵称/圈名 |
| T10 内容与收藏 | F/src/features/notes、social/screens/CreatePostScreen.tsx、discover对应内容页、profile/screens/CollectionsScreen.tsx；Create test/content-tracing.test.js；Extend note-submission.spec.tsx、EditNoteScreen.spec.tsx、CollectionsScreen.spec.tsx | note.create/update/collect/draft/save/delete/restore/status/send/export、post.publish/comment/like/signup、collection.list/open/remove；编辑输入不常驻span | 草稿本地成功远端失败、缓存恢复、录音被取消、上传失败、保存乐观回滚、批量部分成功、返回/播放器释放；沿用已有note span不重复 |
| T11 我的与全部设置/商业 | F/src/features/profile/screens（附录全部）、components/settings-detail.tsx、hooks/use-storage-actions.ts、services/cache/clear-app-cache.ts、API商业模块；Create test/profile-commerce-tracing.test.js；Extend 现有设置行为测试 | settings.read/write/permission/cache、security.password/email/code/devices/cancelAccount、wallet.transfer、mall.purchase、membership.renew、fancy.switch、avatar.equip、support.open | 本地偏好不伪造API；切号旧回调不串；认证失败/余额不足是业务拒绝；仅隔离测试币/测试账号验收，不触发真实充值注销 |
| T12 媒体、位置、QR、推送、通话 | F/src/services/api/upload.ts、features/location、qr、notifications、call、utils/save-image.ts/.web.ts；B/src/upload、notification、call；Create test/device-flows-tracing.test.js、test/upload-tracing.test.js、test/push-call-tracing.test.js | media.prepare/presign/transfer/confirm/save、location.pick/geocode、qr.scan/resolve/accept、push.receive/open/route/token、call.invite/accept/connect/end | iOS/Android/Web权限拒绝与取消、预签名PUT无头泄漏、后台点击与冷启动、token轮换、房间超时/重连、来电退出；第三方内部不假装可见 |
| T13 助手/搜索/启动/OTA与非页面宿主 | F/src/features/assistant、search、app-update、storage、components/app/{session-bootstrap,AppOperationsHost}.tsx；Create test/background-entry-tracing.test.js；Extend OTA与storage测试 | assistant.submit/firstToken/complete、search.execute、app.bootstrap/foreground、storage.init/migrate、ota.check/download/activate/health；流式first-token与total分开 | 搜索词/提示词/回复/本地存储值不泄漏；流式取消、模块缺失、迁移失败、OTA回退、断网、旧release/source-map对齐 |

每个 T7～T13 均执行以下流程；不得把“覆盖一行功能域”当作下面所有功能已验收：

- [ ] 从附录B逐canonical页面列出所有确认操作、表单、长按菜单、弹层、后台触发器，登记到固定操作表；无业务操作的静态页明确记为“只有首屏/导航”。服务API函数与动作关联，非远程纯mapper/辅助函数不单独制造trace。
- [ ] 写该任务指定测试文件的失败用例：给传输stub记录父context；业务完成前span未结束；模拟resolve/reject/cancel检查结果和时长，final envelope不存在哨兵正文；先运行看到失败。
- [ ] 最小实现：UI在确认业务时调用 `withActionTrace`；跨await、队列显式传ActionTrace；公共API/DB自动接后续层，不在每层重复造根span。对原有startOperationSpan接入点做替换/兼容，保留原始错误/重试幂等逻辑。
- [ ] 分别执行确切命令：T7 `node --test test/auth-tracing.test.js`；T8 `node --test test/chat-distributed-tracing.test.js test/local-db-tracing.test.js`；T9 `node --test test/social-management-tracing.test.js`；T10 `node --test test/content-tracing.test.js`；T11 `node --test test/profile-commerce-tracing.test.js`；T12 `node --test test/device-flows-tracing.test.js test/upload-tracing.test.js test/push-call-tracing.test.js`；T13 `node --test test/background-entry-tracing.test.js`。再运行相应目录已有 Jest `.spec.tsx`；成功/失败/取消/部分成功/离开页/切号均有行为断言。
- [ ] 在预生产用该域测试账号做一次App→HTTP→DB实收证明，纯本地功能做本地span证明；记录具体route、release、平台、脱敏截图和trace链接（不含敏感参数）。同任务所有canonical入口状态逐项更新后提交独立PR。

T8 WebSocket 跨仓额外契约：为 send/read/edit/revoke/reaction 等有业务结果的事件增加可选、独立的 `telemetry` 元数据字段，类型只允许合法trace continuation，不混入content，也不持久化到聊天消息正文。老客户端不带字段/老服务端忽略字段仍可工作；协议镜像、DTO/校验器、`test/chat-core-protocol-contract.test.js` 必须一起更新。发送重试保留业务deliveryId，新的传输attempt单列；typing/presence/心跳只统计概要。收到广播的另一用户不继承发送者身份；若需投递关联使用安全link而非复制user scope。

T10、T12 的真实设备失败场景只能在预生产/受控开发包注入。不得在生产故意触发播放器崩溃、删除用户内容或发送干扰性通知。

### T14：所有后端入口、outbox、定时任务及异步关联

**Files:** Modify B/src/metrics/tracked-cron.decorator.ts、B/src/logging/operation-context.ts、B/src/logging/tracing.ts、B/prisma/schema.prisma；必要的nullable元数据迁移 Create B/prisma/migrations/20261105000000_add_outbox_tracing_context/migration.sql（执行前与当前迁移时间线核对，保持唯一且向前追加）；所有附录D Controller由HTTP基础入口统一覆盖；针对所有附录E `*.processor.ts` 及通知/邮件/对象存储/Redis统一调用边界；Create B/src/logging/async-tracing.spec.ts、B/src/logging/tracing-coverage.spec.ts。

**Consumes:** T3/T4 基础和T8协议。**Produces:** 所有后台运行有有限生命周期，不漏用户不可见的失败，异步来源关联独立可查。

```ts
expect(workerSpan.traceId).not.toBe(enqueueSpan.traceId);
expect(workerSpan.links).toContainEqual(sourceSpanContext);
expect(workerScope.user).toBeUndefined();
expect(attemptTwo.businessIdempotencyKey).toBe(attemptOne.businessIdempotencyKey);
expect(allRegisteredProcessorEntrypoints).toEqual(allClassifiedProcessorEntrypoints);
```

- [ ] AST盘点所有 `@Cron`、TrackedCron、processor、网关事件和无HTTP消费者；自动测试新增入口未归类时失败。不要把Controller文件计数当作endpoint覆盖率。
- [ ] TrackedCron每次执行新建有限根span，保持原互斥锁/心跳/metrics与异常处理；无用户scope。每次outbox消费及重试新建attempt，job/queue/attempt仅固定枚举和数字。
- [ ] 需要跨持久队列关联的现有outbox，仅添加可空的专用 tracing metadata（trace_id/span_id/sampled，长度约束）；不把上下文塞业务payload内容。按实际outbox表生成一份向后兼容nullable迁移，旧记录无metadata照常处理，新字段仅暂存到处理/保留期结束，不能加索引作指标标签。修改前对具体Prisma模型/生产迁移流程做schema验证。
- [ ] 后台source trace已结束时使用新trace+link，不伪装无限父子；SDK若当前入口不支持link则在事件额外数据保留经验证来源ID并提供直接查询链接，不能声称UI已经有自动link。该降级须在本任务实收回执中明确。
- [ ] 为每类processor覆成功、重试、死信、重复消费、锁未拿到、上游缺上下文、旧版本payload；跨仓协议升级顺序兼容；不为追踪单独重试业务。
- [ ] `npx jest --runInBand src/logging/async-tracing.spec.ts src/logging/tracing-coverage.spec.ts src/metrics/tracked-cron.decorator.spec.ts`；对所有修改processor执行其现有spec；隔离DB迁移测试后验证旧记录仍可消费。
- [ ] 先上线能读可空字段的后端，再开启写入；回滚只关闭metadata写入与追踪，业务与数据库旧列保留兼容。

### T15：全功能验收、性能与数据安全

**Files:** Extend F/test/tracing-coverage.test.js、F/test/sentry-report-context.test.js、B/src/logging/aggregation-privacy.spec.ts；Create F/docs/observability-tracing-acceptance.md；修改已有e2e流程（scripts/run-e2e.mjs所用配置）加入安全测试标记而非真实用户数据。

- [ ] 覆盖门禁：附录所有249路由有分类；130canonical入口逐项首屏/操作状态；43API模块272导出函数已分类为远程/纯映射/内部helper；所有实际Controller方法/WS事件/processor有公共或手动追踪归属；数量变化需更新清单与差异解释。
- [ ] 功能门禁：T7～T13每域每平台至少一次真实受控端到端成功与一次可恢复失败；高风险认证/聊天/商业/内容写入额外取消、切号、重试测试。静态页/本地功能以无API方式验收，不能为凑覆盖率访问后端。
- [ ] 最终发送envelope安全测试同时覆盖span、transaction、error、breadcrumbs、attachments；注入含邮箱/令牌/聊天/SQL/坐标/邀请code哨兵的数据，上传内容无哨兵；用户字段仅内部ID。TraceId、parentSpanId合法且不混淆requestId。
- [ ] 并发：两个页面后台请求、两个消息、刷新token、上传同时进行，trace归属正确；切号/注销后旧请求不归新用户；未采样error不被取消上报。
- [ ] 故障：Sentry DNS不可达、SDK抛错、额度/网络失败、队列满、进程关闭；业务响应与原异常一致，flush仅关闭时有deadline，日志/指标不能形成递归错误风暴。
- [ ] 性能按4.4基线执行并记录样本数量和波动；统计每次主要业务的span数量、envelope字节、日volume预估；sampling5%不是未测CPU/网络开销的证明。
- [ ] 前端全套 `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:behavior -- --runInBand`、`npm run expo:config`；Windows Node/Bash测试使用现有已验证Git Bash环境，不修改测试掩盖沙箱限制。后端 `npm run build`、`npx eslint "src/**/*.ts" --no-fix`（不用会改代码的npm run lint）、`npm test -- --runInBand`；集成/e2e只用隔离依赖与测试账号。
- [ ] 回执包括：环境、平台、前后端release/dist、业务名称、route模板、trace链接、App/client/server/DB实际parent关系、匿名/切号结果、采样与隐私检查、已知第三方不可见边界。离线单测不能填成真实实收通过。

### T16：部署、源码映射、总览和回滚

**Files:** Modify F/docs/observability.md、F/scripts/upload-expo-sourcemaps.mjs、F/.github/workflows/ios-release.yml、android-release.yml、android-preprod-build.yml、daily-android-build.yml（按实际参与构建的job修改，不建重复发版工作流）；B/docs/observability.md、B/deploy/gen-env.sh、B/deploy/release-deploy.sh、B/.github/workflows/release.yml、B/src/config/env.validation.ts；服务器现有 `/home/ubuntu/circle_be` 和 `/home/ubuntu/.config/circle-monitoring` 只经既有部署入口修改。

**控制开关：**在 T5/F/src/observability/sentry.ts 接入 `EXPO_PUBLIC_TRACING_ENABLED`（缺省保持旧局部追踪，false关闭新增性能）、`EXPO_PUBLIC_TRACE_PROPAGATION_ENABLED`（缺省false，仅兼容后端验收后开启）；生产默认根采样5%，预生产通过构建配置短时100%。后端沿用 `LOG_AGGREGATION_PROVIDER`、`SENTRY_DSN`、`SENTRY_TRACES_SAMPLE_RATE`，不新造同义开关；切性能采样为0保留错误捕获。前端公开开关不是secret，也不能用于授予生产debug权限。

- [ ] 执行前重新只读检查服务器版本、后端provider/DSN、Sentry项目/组织权限、现有Discord集成、配额与源码映射；不读出secret到聊天，不新建重复Discord频道/webhook。
- [ ] 后端使用同一Sentry组织的独立Node项目以区分release/issue；已有项目则复用，若无则创建一个必要后端项目并记录DSN到服务器安全配置，不复用RN项目冒充服务类型。跨项目TraceId联查通过后才宣称串联。Sentry账户功能不可用时记录实际限制，不用本地测试冒充远程界面可用。
- [ ] 先发兼容后端（CORS、旧WS/旧outbox仍兼容），在预生产开启短时全采样，上传同构建Node source maps；再发前端测试包，上传同release/dist的RN artifacts；Android/iOS/Web分别验收。源码映射token只在私有CI，不放EXPO_PUBLIC。
- [ ] T15通过后按功能域逐批开启生产5%采样；本地页面/动作接入率100%不意味着全量trace上传。每批至少观察24小时或完成足够真实流量样本，低流量不足要明确，不能仅按时间通过。
- [ ] 复用Sentry建立“客户端与端到端”总览：release/platform/route/operation筛选、首屏p95、API客户端与服务端对照、关键动作成功/失败/取消、DB往返与失败；分位数从分布计算，不平均实例p95。不声称新包之前历史能补回。
- [ ] Grafana继续显示后端指标/队列/资源/Loki；加入真实traceId查询范例和Sentry链接，不能把ID变成Prometheus或Loki索引标签。错误到日志和trace联查需一次真实演示，不承诺已建自动exemplar。
- [ ] 告警复用 `#sentry`（客户端/Node错误与性能）、`#alertmanager`（资源/服务）、`#uptime`（公网）。先只开明确可行动的阈值，检查持续时间、采样低流量与恢复消息；禁用trace采样不能关闭原有服务器指标告警。
- [ ] 回滚顺序：关闭业务动作性能开关/采样→关闭客户端传播→关闭后端性能；错误捕获、指标、requestId、业务协议保持可用；后端旧schema兼容可空trace元数据。保留各批前一构建及配置；不重建/删除监控卷。
- [ ] 清理本轮测试进程与临时服务，确认退出；更新回执和所有任务状态，完成后才合并ready PR并按已有发版授权发布。

## 7. 全局验收清单

- [ ] 覆盖：全部路由、共享页面、公共API、WebSocket、后台任务有登记；新增入口有漂移测试。
- [ ] 关联：每个已采样同步测试操作共享Trace ID且parent正确；页面之后的动作/异步任务不是无限长trace。
- [ ] 真实计时：使用单调时钟与实际业务边界；不填固定耗时，不把队列入队当服务确认，不把DB往返当纯执行时间。
- [ ] 隐私：最终envelope和日志全链通过哨兵检查；仅明确允许的内部user.id，任何指标无用户/请求ID标签。
- [ ] 稳定：无SDK/断网/取消/切号/过载不改变业务；未增加业务重试/双写/重复指标/重复异常。
- [ ] 可解释：失败、取消、权限拒绝、部分成功分别可见；只采样性能不抹掉错误；缺数据不当0。
- [ ] 平台：iOS adhoc安装方式、Android、Web预检和本地DB差异都验收；纯静态/纯本地页无伪造服务端链路。
- [ ] 发布：同构建source maps；Node项目与RN项目跨项目可查；Sentry真实收件与既有Discord告警通过；回滚实测；单机失联边界说明保留。

## 8. 参考与执行注意

- Sentry React Native SDK 类型与源码：`F/node_modules/@sentry/core/build/types/tracing/trace.d.ts`、`F/node_modules/@sentry/react-native`；Node SDK：`B/node_modules/@sentry/node/build/types`。本计划以安装版本契约测试为准，不直接复制旧版v8博客或假定Prisma 6插件兼容Prisma 7。
- [Sentry React Native distributed tracing](https://docs.sentry.io/platforms/react-native/tracing/trace-propagation/)
- [Sentry Node tracing](https://docs.sentry.io/platforms/javascript/guides/node/tracing/)
- [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

本计划拆成前端基础、后端/DB、业务域、异步流程、发布五个可独立评审的子项目，但共享一份路由与功能清单，避免只完成收藏页就停止。执行时更新下列附录每项状态和具体测试证据；当前附录是静态扫描快照，不是已完成埋点证明。

**编写期自检：**已比对实时路由树与附录快照一致；逐项检查249路由、130共享入口、43模块272导出函数、57 Controller均列入；19功能目录、16任务、代码围栏与无未定义待填标记检查通过。这只是计划文件的完整性检查，没有执行本计划的新业务测试、发包或生产部署。

<!-- GENERATED_INVENTORY_START -->

## 附录 A：全部路由逐项覆盖清单

下表每行均先由 T6 获得页面基础覆盖，再执行功能任务。相同共享页面只实现一次，但各tab入口、返回与深链都要实测；任务分配是主归属，跨域动作仍按功能矩阵执行。特殊/重定向路由只验收实际落页或404，不假造数据请求。

| 状态 | 路由源文件 F/ | 共享入口引用（若无则为本文件逻辑） | 主任务 |
| --- | --- | --- | --- |
| [ ] | `app/(auth)/device-verification.tsx` | `@/features/auth/screens/DeviceVerificationScreen` | T6 + T7 |
| [ ] | `app/(auth)/forgot-password.tsx` | `@/features/auth/screens/ForgotPasswordScreen` | T6 + T7 |
| [ ] | `app/(auth)/login.tsx` | `@/features/auth/screens/LoginScreen` | T6 + T7 |
| [ ] | `app/(auth)/register.tsx` | `@/features/auth/screens/RegisterScreen` | T6 + T7 |
| [ ] | `app/(chat)/chat-detail.tsx` | `@/features/chat/screens/ChatDetailScreen` | T6 + T8 |
| [ ] | `app/(chat)/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(chat)/group-call.tsx` | `@/features/call/screens/GroupCallScreen` | T6 + T12 |
| [ ] | `app/(chat)/location-picker.tsx` | `@/features/chat/screens/ChatLocationPickerScreen` | T6 + T12 |
| [ ] | `app/(onboarding)/profile.tsx` | `@/features/auth/screens/OnboardingProfileScreen` | T6 + T7 |
| [ ] | `app/(social)/add-friend.tsx` | `@/features/social/screens/AddFriendScreen` | T6 + T9 |
| [ ] | `app/(social)/create-post.tsx` | `@/features/social/screens/CreatePostScreen` | T6 + T10 |
| [ ] | `app/(tabs)/contacts/add-friend.tsx` | `@/features/social/screens/AddFriendScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/chat-detail.tsx` | `@/features/chat/screens/ChatDetailScreen` | T6 + T8 |
| [ ] | `app/(tabs)/contacts/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(tabs)/contacts/circle-guide.tsx` | `@/features/discover/screens/CircleGuideScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/circle-notifications.tsx` | `@/features/discover/screens/CircleNotificationSettingsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/circles.tsx` | `@/features/discover/screens/MyCirclesScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/edit-group-notice.tsx` | `@/features/chat/screens/EditGroupNoticeScreen` | T6 + T8 |
| [ ] | `app/(tabs)/contacts/group-entry.tsx` | `@/features/groups/GroupEntryScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/group-log.tsx` | `@/features/chat/screens/GroupLogScreen` | T6 + T8 |
| [ ] | `app/(tabs)/contacts/group-manage.tsx` | `@/features/chat/screens/GroupManageScreen` | T6 + T8 |
| [ ] | `app/(tabs)/contacts/groups.tsx` | `@/features/contacts/screens/GroupsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/index.tsx` | `@/features/contacts/screens/ContactsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/moments.tsx` | `@/features/discover/screens/MomentsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/contacts/new-friends/[id].tsx` | `@/features/contacts/screens/FriendActivityDetailScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/new-friends.tsx` | `@/features/contacts/screens/NewFriendsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/note-management.tsx` | `@/features/notes/screens/NoteManagementScreen` | T6 + T10 |
| [ ] | `app/(tabs)/contacts/notes/[id].tsx` | `@/features/notes/screens/NoteDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/contacts/qr.tsx` | `@/features/qr/screens/QrLandingScreen` | T6 + T12 |
| [ ] | `app/(tabs)/contacts/search-group-members.tsx` | `@/features/chat/screens/SearchGroupMembersScreen` | T6 + T8 |
| [ ] | `app/(tabs)/contacts/search.tsx` | `@/features/search/screens/SearchScreen` | T6 + T13 |
| [ ] | `app/(tabs)/contacts/seats.tsx` | `@/features/messages/screens/TempChatsScreen` | T6 + T8 |
| [ ] | `app/(tabs)/contacts/tags/[id].tsx` | `@/features/contacts/screens/FriendTagDetailScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/tags.tsx` | `@/features/contacts/screens/FriendTagsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/user/[id]/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(tabs)/contacts/user/[id]/moments.tsx` | `@/features/discover/screens/UserMomentsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/contacts/user/[id]/permission.tsx` | `@/features/user/screens/EditFriendPermissionScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/user/[id]/remark.tsx` | `@/features/user/screens/EditFriendRemarkScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/user/[id]/request.tsx` | `@/features/social/screens/SendFriendRequestScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/user/[id]/tags.tsx` | `@/features/user/screens/EditFriendTagsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/contacts/user/[id].tsx` | `@/features/user/screens/UserProfileScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/chat-detail.tsx` | `@/features/chat/screens/ChatDetailScreen` | T6 + T8 |
| [ ] | `app/(tabs)/discover/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(tabs)/discover/circle/[id]/admin.tsx` | `@/features/discover/screens/AdminReviewScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/circle/[id]/edit.tsx` | `@/features/discover/screens/EditCircleScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/circle/[id]/invite-friends.tsx` | `@/features/discover/screens/InviteToCircleScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/circle/[id]/invite.tsx` | `@/features/discover/screens/InviteCircleMenuScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/circle/[id]/posts.tsx` | `@/features/discover/screens/CirclePostsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/circle/[id]/share.tsx` | `@/features/discover/screens/ShareCircleCardScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/circle/[id].tsx` | `@/features/discover/screens/CircleDetailScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/create-circle.tsx` | `@/features/discover/screens/CreateCircleScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/create-moment.tsx` | `@/features/discover/screens/CreateMomentScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/create-post.tsx` | `@/features/social/screens/CreatePostScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/edit-group-notice.tsx` | `@/features/chat/screens/EditGroupNoticeScreen` | T6 + T8 |
| [ ] | `app/(tabs)/discover/filter.tsx` | `@/features/discover/screens/FilterScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/group-entry.tsx` | `@/features/groups/GroupEntryScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/group-log.tsx` | `@/features/chat/screens/GroupLogScreen` | T6 + T8 |
| [ ] | `app/(tabs)/discover/group-manage.tsx` | `@/features/chat/screens/GroupManageScreen` | T6 + T8 |
| [ ] | `app/(tabs)/discover/guide.tsx` | `@/features/discover/screens/CircleGuideScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/index.tsx` | `@/features/discover/screens/CirclePlazaScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/invitation/[id]/select-verifier.tsx` | `@/features/discover/screens/SelectVerifierScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/invitation/[id].tsx` | `@/features/discover/screens/InvitationVerificationScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/invite-group-members.tsx` | `@/features/chat/screens/InviteGroupMembersScreen` | T6 + T8 |
| [ ] | `app/(tabs)/discover/management.tsx` | `@/features/discover/screens/CircleManagementScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/moment/[id].tsx` | `@/features/discover/screens/MomentDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/moments.tsx` | `@/features/discover/screens/MomentsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/note-management.tsx` | `@/features/notes/screens/NoteManagementScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/notes/[id].tsx` | `@/features/notes/screens/NoteDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/notification-center.tsx` | `@/features/notifications/screens/NotificationCenterScreen` | T6 + T12 |
| [ ] | `app/(tabs)/discover/notifications.tsx` | `@/features/discover/screens/CircleNotificationSettingsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/plaza-post-detail.tsx` | `@/features/discover/screens/PlazaPostDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/post-signups.tsx` | `@/features/notifications/screens/PostSignupsScreen` | T6 + T12 |
| [ ] | `app/(tabs)/discover/qr.tsx` | `@/features/qr/screens/QrLandingScreen` | T6 + T12 |
| [ ] | `app/(tabs)/discover/search-group-members.tsx` | `@/features/chat/screens/SearchGroupMembersScreen` | T6 + T8 |
| [ ] | `app/(tabs)/discover/select-circle.tsx` | `@/features/discover/screens/SelectCircleScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/select-city.tsx` | `@/features/discover/screens/SelectCityScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/select-filter-circles.tsx` | `@/features/discover/screens/SelectFilterCirclesScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/select-note.tsx` | `@/features/social/screens/SelectNoteScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/share-post.tsx` | `@/features/discover/screens/SharePlazaPostScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/user/[id]/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(tabs)/discover/user/[id]/moments.tsx` | `@/features/discover/screens/UserMomentsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/discover/user/[id]/permission.tsx` | `@/features/user/screens/EditFriendPermissionScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/user/[id]/remark.tsx` | `@/features/user/screens/EditFriendRemarkScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/user/[id]/request.tsx` | `@/features/social/screens/SendFriendRequestScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/user/[id]/tags.tsx` | `@/features/user/screens/EditFriendTagsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/user/[id].tsx` | `@/features/user/screens/UserProfileScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/verification/[id].tsx` | `@/features/discover/screens/VerificationRequestScreen` | T6 + T9 |
| [ ] | `app/(tabs)/discover/verifications.tsx` | `@/features/discover/screens/PendingVerificationsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/assistant.tsx` | `@/features/assistant/screens/AssistantChatScreen` | T6 + T13 |
| [ ] | `app/(tabs)/explore/chat-detail.tsx` | `@/features/chat/screens/ChatDetailScreen` | T6 + T8 |
| [ ] | `app/(tabs)/explore/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(tabs)/explore/circle/[id]/admin.tsx` | `@/features/discover/screens/AdminReviewScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/circle/[id]/edit.tsx` | `@/features/discover/screens/EditCircleScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/circle/[id]/invite-friends.tsx` | `@/features/discover/screens/InviteToCircleScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/circle/[id]/invite.tsx` | `@/features/discover/screens/InviteCircleMenuScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/circle/[id]/posts.tsx` | `@/features/discover/screens/CirclePostsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/explore/circle/[id]/share.tsx` | `@/features/discover/screens/ShareCircleCardScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/circle/[id].tsx` | `@/features/discover/screens/CircleDetailScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/create-moment.tsx` | `@/features/discover/screens/CreateMomentScreen` | T6 + T10 |
| [ ] | `app/(tabs)/explore/edit-group-notice.tsx` | `@/features/chat/screens/EditGroupNoticeScreen` | T6 + T8 |
| [ ] | `app/(tabs)/explore/group-entry.tsx` | `@/features/groups/GroupEntryScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/group-log.tsx` | `@/features/chat/screens/GroupLogScreen` | T6 + T8 |
| [ ] | `app/(tabs)/explore/group-manage.tsx` | `@/features/chat/screens/GroupManageScreen` | T6 + T8 |
| [ ] | `app/(tabs)/explore/index.tsx` | `@/features/explore/screens/ExploreScreen` | T6 + T13 |
| [ ] | `app/(tabs)/explore/invitation/[id]/select-verifier.tsx` | `@/features/discover/screens/SelectVerifierScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/invitation/[id].tsx` | `@/features/discover/screens/InvitationVerificationScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/invite-group-members.tsx` | `@/features/chat/screens/InviteGroupMembersScreen` | T6 + T8 |
| [ ] | `app/(tabs)/explore/moment/[id].tsx` | `@/features/discover/screens/MomentDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/explore/moments.tsx` | `@/features/discover/screens/MomentsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/explore/note-management.tsx` | `@/features/notes/screens/NoteManagementScreen` | T6 + T10 |
| [ ] | `app/(tabs)/explore/notes/[id].tsx` | `@/features/notes/screens/NoteDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/explore/notification-center.tsx` | `@/features/notifications/screens/NotificationCenterScreen` | T6 + T12 |
| [ ] | `app/(tabs)/explore/plaza-post-detail.tsx` | `@/features/discover/screens/PlazaPostDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/explore/qr.tsx` | `@/features/qr/screens/QrLandingScreen` | T6 + T12 |
| [ ] | `app/(tabs)/explore/search-group-members.tsx` | `@/features/chat/screens/SearchGroupMembersScreen` | T6 + T8 |
| [ ] | `app/(tabs)/explore/select-city.tsx` | `@/features/discover/screens/SelectCityScreen` | T6 + T10 |
| [ ] | `app/(tabs)/explore/user/[id]/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(tabs)/explore/user/[id]/moments.tsx` | `@/features/discover/screens/UserMomentsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/explore/user/[id]/permission.tsx` | `@/features/user/screens/EditFriendPermissionScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/user/[id]/remark.tsx` | `@/features/user/screens/EditFriendRemarkScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/user/[id]/request.tsx` | `@/features/social/screens/SendFriendRequestScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/user/[id]/tags.tsx` | `@/features/user/screens/EditFriendTagsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/user/[id].tsx` | `@/features/user/screens/UserProfileScreen` | T6 + T9 |
| [ ] | `app/(tabs)/explore/verification/[id].tsx` | `@/features/discover/screens/VerificationRequestScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/add-friend.tsx` | `@/features/social/screens/AddFriendScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/assistant.tsx` | `@/features/assistant/screens/AssistantChatScreen` | T6 + T13 |
| [ ] | `app/(tabs)/messages/chat-background.tsx` | `@/features/chat/screens/ChatBackgroundScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/chat-detail.tsx` | `@/features/chat/screens/ChatDetailScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/chat-history-date-results.tsx` | `@/features/chat/screens/ChatHistoryDateResultsScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/chat-history-date.tsx` | `@/features/chat/screens/ChatHistoryDateScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/chat-history-files.tsx` | `@/features/chat/screens/ChatHistoryFilesScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/chat-history-media.tsx` | `@/features/chat/screens/ChatHistoryMediaScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/chat-history-search.tsx` | `@/features/chat/screens/ChatHistorySearchHubScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/chat-history-text.tsx` | `@/features/chat/screens/ChatHistoryTextScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/circle/[id]/admin.tsx` | `@/features/discover/screens/AdminReviewScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/circle/[id]/edit.tsx` | `@/features/discover/screens/EditCircleScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/circle/[id]/invite-friends.tsx` | `@/features/discover/screens/InviteToCircleScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/circle/[id]/invite.tsx` | `@/features/discover/screens/InviteCircleMenuScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/circle/[id]/posts.tsx` | `@/features/discover/screens/CirclePostsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/messages/circle/[id]/share.tsx` | `@/features/discover/screens/ShareCircleCardScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/circle/[id].tsx` | `@/features/discover/screens/CircleDetailScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/create-circle.tsx` | `@/features/discover/screens/CreateCircleScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/edit-group-notice.tsx` | `@/features/chat/screens/EditGroupNoticeScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/find.tsx` | `@/features/search/screens/SearchScreen` | T6 + T13 |
| [ ] | `app/(tabs)/messages/forward-picker.tsx` | `@/features/chat/screens/ForwardPickerScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/group-entry.tsx` | `@/features/groups/GroupEntryScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/group-log.tsx` | `@/features/chat/screens/GroupLogScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/group-manage.tsx` | `@/features/chat/screens/GroupManageScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/groups.tsx` | `@/features/messages/screens/GroupManagementScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/index.tsx` | `@/features/messages/screens/MessagesScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/invitation/[id]/select-verifier.tsx` | `@/features/discover/screens/SelectVerifierScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/invitation/[id].tsx` | `@/features/discover/screens/InvitationVerificationScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/invite-group-members.tsx` | `@/features/chat/screens/InviteGroupMembersScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/new-group.tsx` | `@/features/chat/screens/NewGroupScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/note-management.tsx` | `@/features/notes/screens/NoteManagementScreen` | T6 + T10 |
| [ ] | `app/(tabs)/messages/notes/[id].tsx` | `@/features/notes/screens/NoteDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/messages/notifications.tsx` | `@/features/notifications/screens/NotificationCenterScreen` | T6 + T12 |
| [ ] | `app/(tabs)/messages/plaza-post-detail.tsx` | `@/features/discover/screens/PlazaPostDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/messages/post-signups.tsx` | `@/features/notifications/screens/PostSignupsScreen` | T6 + T12 |
| [ ] | `app/(tabs)/messages/qr-login.tsx` | `@/features/qr/screens/QrLoginDeprecatedScreen` | T6 + T12 |
| [ ] | `app/(tabs)/messages/qr.tsx` | `@/features/qr/screens/QrLandingScreen` | T6 + T12 |
| [ ] | `app/(tabs)/messages/recommend-friend.tsx` | `@/features/chat/screens/RecommendFriendScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/report-friend.tsx` | `@/features/chat/screens/ReportFriendScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/scan.tsx` | `@/features/messages/screens/ScanScreen` | T6 + T12 |
| [ ] | `app/(tabs)/messages/search-group-members.tsx` | `@/features/chat/screens/SearchGroupMembersScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/select-city.tsx` | `@/features/discover/screens/SelectCityScreen` | T6 + T10 |
| [ ] | `app/(tabs)/messages/share-picker.tsx` | `@/features/chat/screens/SharePickerScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/temp-chats.tsx` | `@/features/messages/screens/TempChatsScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/transfer-composer.tsx` | `@/features/chat/screens/TransferComposerScreen` | T6 + T8 |
| [ ] | `app/(tabs)/messages/user/[id]/moments.tsx` | `@/features/discover/screens/UserMomentsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/messages/user/[id]/permission.tsx` | `@/features/user/screens/EditFriendPermissionScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/user/[id]/remark.tsx` | `@/features/user/screens/EditFriendRemarkScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/user/[id]/request.tsx` | `@/features/social/screens/SendFriendRequestScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/user/[id]/tags.tsx` | `@/features/user/screens/EditFriendTagsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/user/[id].tsx` | `@/features/user/screens/UserProfileScreen` | T6 + T9 |
| [ ] | `app/(tabs)/messages/verification/[id].tsx` | `@/features/discover/screens/VerificationRequestScreen` | T6 + T9 |
| [ ] | `app/(tabs)/profile/app-settings.tsx` | `@/features/profile/screens/AppSettingsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/avatar-frame/[id].tsx` | `@/features/profile/screens/AvatarFrameDetailScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/avatar-frames.tsx` | `@/features/profile/screens/AvatarFramesScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/cancel-account.tsx` | `@/features/profile/screens/CancelAccountScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/change-email.tsx` | `@/features/profile/screens/ChangeEmailScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/change-password.tsx` | `@/features/profile/screens/ChangePasswordScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/change-security-code.tsx` | `@/features/profile/screens/ChangeSecurityCodeScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/chat-detail.tsx` | `@/features/chat/screens/ChatDetailScreen` | T6 + T8 |
| [ ] | `app/(tabs)/profile/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(tabs)/profile/collections.tsx` | `@/features/profile/screens/CollectionsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/credit-score.tsx` | `@/features/profile/screens/CreditScoreScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/customer-service.tsx` | `@/features/profile/screens/CustomerServiceScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/edit/[field].tsx` | `@/features/profile/screens/EditProfileFieldScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/edit-group-notice.tsx` | `@/features/chat/screens/EditGroupNoticeScreen` | T6 + T8 |
| [ ] | `app/(tabs)/profile/fancy-number.tsx` | `@/features/profile/screens/FancyNumberScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/group-entry.tsx` | `@/features/groups/GroupEntryScreen` | T6 + T9 |
| [ ] | `app/(tabs)/profile/group-expansion.tsx` | `@/features/profile/screens/GroupExpansionScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/group-log.tsx` | `@/features/chat/screens/GroupLogScreen` | T6 + T8 |
| [ ] | `app/(tabs)/profile/group-manage.tsx` | `@/features/chat/screens/GroupManageScreen` | T6 + T8 |
| [ ] | `app/(tabs)/profile/icons.tsx` | `@/features/profile/screens/MyIconsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/index.tsx` | `@/features/profile/screens/ProfileScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/login-devices.tsx` | `@/features/profile/screens/LoginDeviceManagementScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/mall.tsx` | `@/features/profile/screens/MallScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/member-center.tsx` | `@/features/profile/screens/MemberCenterScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/member-rules.tsx` | `@/features/profile/screens/MemberRulesScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/note-management.tsx` | `@/features/notes/screens/NoteManagementScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/notes/drafts.tsx` | `@/features/notes/screens/DraftsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/notes/edit.tsx` | `@/features/notes/screens/EditNoteScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/notes/index.tsx` | `@/features/notes/screens/NotesScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/notes/location-picker.tsx` | `@/features/notes/screens/NoteLocationPickerScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/notes/recycle-bin.tsx` | `@/features/notes/screens/RecycleBinScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/notes/unlisted.tsx` | `@/features/notes/screens/UnlistedNotesScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/notes/[id].tsx` | `@/features/notes/screens/NoteDetailScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/qr.tsx` | `@/features/qr/screens/QrLandingScreen` | T6 + T12 |
| [ ] | `app/(tabs)/profile/search-group-members.tsx` | `@/features/chat/screens/SearchGroupMembersScreen` | T6 + T8 |
| [ ] | `app/(tabs)/profile/settings-about-licenses.tsx` | `@/features/profile/screens/ThirdPartyLicensesScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-about-privacy-policy.tsx` | `@/features/profile/screens/AboutPrivacyPolicyScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-about-product.tsx` | `@/features/profile/screens/AboutProductScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-about-user-agreement.tsx` | `@/features/profile/screens/AboutUserAgreementScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-about-version.tsx` | `@/features/profile/screens/AboutVersionScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-about.tsx` | `@/features/profile/screens/AboutSettingsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-account-security.tsx` | `@/features/profile/screens/AccountSecuritySettingsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-appearance.tsx` | `@/features/profile/screens/AppearanceSettingsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-auto-reply.tsx` | `@/features/profile/screens/DirectMessageAutoReplyScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-blacklist.tsx` | `@/features/profile/screens/BlacklistSettingsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-chat-background.tsx` | `@/features/chat/screens/ChatBackgroundScreen` | T6 + T8 |
| [ ] | `app/(tabs)/profile/settings-notifications.tsx` | `@/features/profile/screens/NotificationSettingsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-permissions.tsx` | `@/features/profile/screens/SystemPermissionsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-privacy.tsx` | `@/features/profile/screens/PrivacySettingsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-storage-usage.tsx` | `@/features/profile/screens/StorageUsageScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings-storage.tsx` | `@/features/profile/screens/StorageSettingsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/settings.tsx` | `@/features/profile/screens/SettingsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/share.tsx` | `@/features/profile/screens/ShareScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/support-agents.tsx` | `@/features/profile/screens/SupportAgentsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/system-announcements/[id].tsx` | `@/features/profile/screens/SystemAnnouncementDetailScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/system-announcements.tsx` | `@/features/profile/screens/SystemAnnouncementsScreen` | T6 + T11 |
| [ ] | `app/(tabs)/profile/user/[id]/chat-info.tsx` | `@/features/chat/screens/ChatInfoScreen` | T6 + T8 |
| [ ] | `app/(tabs)/profile/user/[id]/moments.tsx` | `@/features/discover/screens/UserMomentsScreen` | T6 + T10 |
| [ ] | `app/(tabs)/profile/user/[id]/permission.tsx` | `@/features/user/screens/EditFriendPermissionScreen` | T6 + T9 |
| [ ] | `app/(tabs)/profile/user/[id]/remark.tsx` | `@/features/user/screens/EditFriendRemarkScreen` | T6 + T9 |
| [ ] | `app/(tabs)/profile/user/[id]/request.tsx` | `@/features/social/screens/SendFriendRequestScreen` | T6 + T9 |
| [ ] | `app/(tabs)/profile/user/[id]/tags.tsx` | `@/features/user/screens/EditFriendTagsScreen` | T6 + T9 |
| [ ] | `app/(tabs)/profile/user/[id].tsx` | `@/features/user/screens/UserProfileScreen` | T6 + T9 |
| [ ] | `app/(tabs)/profile/wallet.tsx` | `@/features/profile/screens/WalletScreen` | T6 + T11 |
| [ ] | `app/+not-found.tsx` | `内联路由/重定向/特殊页面` | T6 + T6 |
| [ ] | `app/index.tsx` | `内联路由/重定向/特殊页面` | T6 + T6 |
| [ ] | `app/invite/[code].tsx` | `@/features/auth/screens/InviteLinkScreen` | T6 + T7 |
| [ ] | `app/invite.tsx` | `@/features/auth/screens/InviteLinkScreen` | T6 + T7 |
| [ ] | `app/qr-code.tsx` | `@/features/qr/screens/QrCodeScreen` | T6 + T12 |
| [ ] | `app/qr-login.tsx` | `@/features/qr/screens/QrLoginDeprecatedScreen` | T6 + T12 |
| [ ] | `app/qr.tsx` | `@/features/qr/screens/QrLandingScreen` | T6 + T12 |
| [ ] | `app/search.tsx` | `@/features/search/screens/SearchScreen` | T6 + T13 |

## 附录 B：共享页面/功能入口行为验收

不是仅检查hook导入；每行对应功能矩阵的读取、写入、取消和退出场景。纯静态页可标记“首屏通过、无业务写入”，选择器标记其确认/取消，不能静默跳过。

| 状态 | 实际源文件 F/ | 主任务 |
| --- | --- | --- |
| [ ] | `src/features/assistant/screens/AssistantChatScreen.tsx` | T6 + T13 |
| [ ] | `src/features/auth/screens/DeviceVerificationScreen.tsx` | T6 + T7 |
| [ ] | `src/features/auth/screens/ForgotPasswordScreen.tsx` | T6 + T7 |
| [ ] | `src/features/auth/screens/InviteLinkScreen.tsx` | T6 + T7 |
| [ ] | `src/features/auth/screens/LoginScreen.tsx` | T6 + T7 |
| [ ] | `src/features/auth/screens/OnboardingProfileScreen.tsx` | T6 + T7 |
| [ ] | `src/features/auth/screens/RegisterScreen.tsx` | T6 + T7 |
| [ ] | `src/features/call/screens/GroupCallScreen.tsx` | T6 + T12 |
| [ ] | `src/features/chat/screens/ChatBackgroundScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ChatDetailScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ChatHistoryDateResultsScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ChatHistoryDateScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ChatHistoryFilesScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ChatHistoryMediaScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ChatHistorySearchHubScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ChatHistoryTextScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ChatInfoScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ChatLocationPickerScreen.tsx` | T6 + T12 |
| [ ] | `src/features/chat/screens/EditGroupNoticeScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ForwardPickerScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/GroupLogScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/GroupManageScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/InviteGroupMembersScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/NewGroupScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/RecommendFriendScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/ReportFriendScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/SearchGroupMembersScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/SharePickerScreen.tsx` | T6 + T8 |
| [ ] | `src/features/chat/screens/TransferComposerScreen.tsx` | T6 + T8 |
| [ ] | `src/features/contacts/screens/ContactsScreen.tsx` | T6 + T9 |
| [ ] | `src/features/contacts/screens/FriendActivityDetailScreen.tsx` | T6 + T9 |
| [ ] | `src/features/contacts/screens/FriendTagDetailScreen.tsx` | T6 + T9 |
| [ ] | `src/features/contacts/screens/FriendTagsScreen.tsx` | T6 + T9 |
| [ ] | `src/features/contacts/screens/GroupsScreen.tsx` | T6 + T9 |
| [ ] | `src/features/contacts/screens/NewFriendsScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/AdminReviewScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/CircleDetailScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/CircleGuideScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/CircleManagementScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/CircleNotificationSettingsScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/CirclePlazaScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/CirclePostsScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/CreateCircleScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/CreateMomentScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/EditCircleScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/FilterScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/InvitationVerificationScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/InviteCircleMenuScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/InviteToCircleScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/MomentDetailScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/MomentsScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/MyCirclesScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/PendingVerificationsScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/PlazaPostDetailScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/SelectCircleScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/SelectCityScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/SelectFilterCirclesScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/SelectVerifierScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/ShareCircleCardScreen.tsx` | T6 + T9 |
| [ ] | `src/features/discover/screens/SharePlazaPostScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/UserMomentsScreen.tsx` | T6 + T10 |
| [ ] | `src/features/discover/screens/VerificationRequestScreen.tsx` | T6 + T9 |
| [ ] | `src/features/explore/screens/ExploreScreen.tsx` | T6 + T13 |
| [ ] | `src/features/groups/GroupEntryScreen.tsx` | T6 + T9 |
| [ ] | `src/features/messages/screens/GroupManagementScreen.tsx` | T6 + T8 |
| [ ] | `src/features/messages/screens/MessagesScreen.tsx` | T6 + T8 |
| [ ] | `src/features/messages/screens/ScanScreen.tsx` | T6 + T12 |
| [ ] | `src/features/messages/screens/TempChatsScreen.tsx` | T6 + T8 |
| [ ] | `src/features/notes/screens/DraftsScreen.tsx` | T6 + T10 |
| [ ] | `src/features/notes/screens/EditNoteScreen.tsx` | T6 + T10 |
| [ ] | `src/features/notes/screens/NoteDetailScreen.tsx` | T6 + T10 |
| [ ] | `src/features/notes/screens/NoteLocationPickerScreen.tsx` | T6 + T10 |
| [ ] | `src/features/notes/screens/NoteManagementScreen.tsx` | T6 + T10 |
| [ ] | `src/features/notes/screens/NotesScreen.tsx` | T6 + T10 |
| [ ] | `src/features/notes/screens/RecycleBinScreen.tsx` | T6 + T10 |
| [ ] | `src/features/notes/screens/UnlistedNotesScreen.tsx` | T6 + T10 |
| [ ] | `src/features/notifications/screens/NotificationCenterScreen.tsx` | T6 + T12 |
| [ ] | `src/features/notifications/screens/PostSignupsScreen.tsx` | T6 + T12 |
| [ ] | `src/features/profile/screens/AboutPrivacyPolicyScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/AboutProductScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/AboutSettingsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/AboutUserAgreementScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/AboutVersionScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/AccountSecuritySettingsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/AppSettingsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/AppearanceSettingsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/AvatarFrameDetailScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/AvatarFramesScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/BlacklistSettingsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/CancelAccountScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/ChangeEmailScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/ChangePasswordScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/ChangeSecurityCodeScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/CollectionsScreen.tsx` | T6 + T10 |
| [ ] | `src/features/profile/screens/CreditScoreScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/CustomerServiceScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/DirectMessageAutoReplyScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/EditProfileFieldScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/FancyNumberScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/GroupExpansionScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/LoginDeviceManagementScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/MallScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/MemberCenterScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/MemberRulesScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/MyIconsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/NotificationSettingsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/PrivacySettingsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/ProfileScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/SettingsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/ShareScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/StorageSettingsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/StorageUsageScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/SupportAgentsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/SystemAnnouncementDetailScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/SystemAnnouncementsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/SystemPermissionsScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/ThirdPartyLicensesScreen.tsx` | T6 + T11 |
| [ ] | `src/features/profile/screens/WalletScreen.tsx` | T6 + T11 |
| [ ] | `src/features/qr/screens/QrCodeScreen.tsx` | T6 + T12 |
| [ ] | `src/features/qr/screens/QrLandingScreen.tsx` | T6 + T12 |
| [ ] | `src/features/qr/screens/QrLoginDeprecatedScreen.tsx` | T6 + T12 |
| [ ] | `src/features/search/screens/SearchScreen.tsx` | T6 + T13 |
| [ ] | `src/features/social/screens/AddFriendScreen.tsx` | T6 + T9 |
| [ ] | `src/features/social/screens/CreatePostScreen.tsx` | T6 + T10 |
| [ ] | `src/features/social/screens/SelectNoteScreen.tsx` | T6 + T10 |
| [ ] | `src/features/social/screens/SendFriendRequestScreen.tsx` | T6 + T9 |
| [ ] | `src/features/user/screens/EditFriendPermissionScreen.tsx` | T6 + T9 |
| [ ] | `src/features/user/screens/EditFriendRemarkScreen.tsx` | T6 + T9 |
| [ ] | `src/features/user/screens/EditFriendTagsScreen.tsx` | T6 + T9 |
| [ ] | `src/features/user/screens/UserProfileScreen.tsx` | T6 + T9 |

## 附录 C：API 全导出函数归类清单

共43个模块、272个具名导出函数；其中校验器/映射器/纯工具不是独立网络操作。T1将其分为远程请求、请求包装、纯函数三类；远程调用均由T2接通，业务完成语义由T7～T13验收。不能为272个函数都生成独立根trace。

| 状态 | 文件 F/ | 导出函数 |
| --- | --- | --- |
| [ ] | `src/services/api/app-operations.ts` | `recordAppOpen`, `getManagedUpdate` |
| [ ] | `src/services/api/assistant.ts` | `fetchAssistantBootstrap`, `createAssistantSubscription`, `updateAssistantPreferences` |
| [ ] | `src/services/api/auth.ts` | `login`, `fetchLoginChallengeStatus`, `verifyLoginChallengeCode`, `verifyLoginChallengeSecurityCode`, `resendLoginChallenge`, `requestLoginRecovery`, `fetchPendingLoginChallenges`, `approveLoginChallenge`, `rejectLoginChallenge`, `register`, `fetchCurrentUser`, `fetchCurrentUserWithToken`, `logout`, `requestPasswordReset`, `resetPassword`, `changePassword`, `requestEmailChange`, `changeEmail`, `deleteAccount`, `fetchLoginSecurityCodeStatus`, `setLoginSecurityCode`, `disableLoginSecurityCode`, `verifyLoginSecurityCode`, `logoutAll`, `fetchAuthSessions`, `revokeAuthSession`, `logoutOtherSessions`, `fetchSingleDeviceLoginStatus`, `setSingleDeviceLogin` |
| [ ] | `src/services/api/avatar-frames.ts` | `getInvalidUserAppearanceIds`, `fetchAvatarFrameInventory`, `equipAvatarFrame`, `fetchUserAppearances` |
| [ ] | `src/services/api/call-mappers.ts` | `normalizeParticipant`, `normalizeCall`, `normalizeCallActionResponse` |
| [ ] | `src/services/api/calls.ts` | `createGroupCall`, `acceptCall`, `rejectCall`, `leaveCall`, `cancelCall`, `requestJoinToken`, `createDirectCall`, `fetchCurrentCall` |
| [ ] | `src/services/api/circles.ts` | `markCircleWrite`, `circlesMutatedSince`, `fetchMyCircles`, `fetchCircleDetail`, `createCircle`, `updateCircle`, `joinCircle`, `leaveCircle`, `dissolveCircle`, `uploadCircleIcon`, `selectCircleIcon`, `setCircleCover`, `setCircleAvatar`, `inviteToCircle`, `fetchInvitation`, `fetchEligibleVerifiers`, `addVerifierToInvitation`, `respondToVerification`, `adminApproveInvitation`, `fetchMyPendingVerifications`, `fetchMyApplications`, `fetchPendingInvitationsForCircle`, `respondToCircleInvitation`, `markCircleInvitationSeen` |
| [ ] | `src/services/api/client.ts` | `isDefinitiveAuthFailure`, `registerDeviceIdProvider`, `refreshSessionAccessToken`, `apiClient` |
| [ ] | `src/services/api/coin.ts` | `fetchWallet`, `fetchCoinTransactions`, `sendCoinGift` |
| [ ] | `src/services/api/collect-cursor-pages.ts` | `collectCursorPages` |
| [ ] | `src/services/api/collections.ts` | `fetchCollections`, `createCollection`, `deleteCollection` |
| [ ] | `src/services/api/conversation-groups.ts` | `fetchConversationGroups`, `createConversationGroup`, `updateConversationGroup`, `deleteConversationGroup`, `setConversationGroupMembers` |
| [ ] | `src/services/api/credit-policy.ts` | `getCreditPolicyMessage`, `resetCreditGateTelemetry`, `getLocalLowCreditDecision`, `assertLocalCanSendMessage` |
| [ ] | `src/services/api/credit.ts` | `fetchCreditEvents` |
| [ ] | `src/services/api/errors.ts` | `getApiErrorMessage` |
| [ ] | `src/services/api/fancy-number.ts` | `fetchFancyNumbers`, `fetchMyFancyNumber`, `checkFancyNumberAvailability`, `purchaseFancyNumber`, `renewFancyNumber`, `switchPermanentFancyNumber`, `purchaseCustomFancyNumber`, `switchPermanentToCustomFancyNumber` |
| [ ] | `src/services/api/friends.ts` | `friendsMutatedSince`, `fetchFriends`, `fetchFriendTags`, `createFriendTag`, `fetchFriendsByTag`, `fetchFriendStatus`, `fetchFriendSettings`, `addFriendToBlacklist`, `removeFriendFromBlacklist`, `fetchBlockedUsers`, `deleteFriendRelationship`, `setFriendRemark`, `setFriendPermission`, `assignFriendTag`, `removeFriendTag`, `createFriendRequest`, `createFriendRequest`, `createFriendRequest`, `fetchFriendActivities`, `fetchUnreadFriendActivityCount`, `fetchFriendActivityDetail`, `markFriendActivityRead`, `acceptFriendRequest`, `rejectFriendRequest`, `cancelFriendRequest`, `reportFriend`, `fetchFriendRequestMessages`, `sendFriendRequestMessage` |
| [ ] | `src/services/api/group-admissions.ts` | `fetchGroupPreview`, `fetchGroupAdmission`, `applyToGroup`, `actOnGroupAdmission`, `fetchGroupAdmissions`, `acceptGroupQrInvitation`, `refreshGroupAdmissionUnread`, `markGroupAdmissionSeen` |
| [ ] | `src/services/api/group-expansion.ts` | `fetchGroupExpansionProducts`, `purchaseGroupExpansion` |
| [ ] | `src/services/api/group-writes.ts` | `markGroupWrite`, `groupsMutatedSince` |
| [ ] | `src/services/api/groups.ts` | `leaveGroup`, `removeGroupMember`, `updateGroupMemberRole`, `reportGroup` |
| [ ] | `src/services/api/icons.ts` | `fetchIconOptions`, `updateDisplayIcons` |
| [ ] | `src/services/api/image-media.ts` | `normalizeImageMediaVariant`, `normalizeImageMedia` |
| [ ] | `src/services/api/mall.ts` | `fetchMallSections` |
| [ ] | `src/services/api/membership.ts` | `fetchMembershipPlans`, `fetchMembershipProgramStatus` |
| [ ] | `src/services/api/moments.ts` | `normalizeMomentComment`, `normalizeMoment`, `fetchMomentsFeed`, `fetchUserMoments`, `fetchNewMomentsCount`, `fetchMomentById`, `createMoment`, `deleteMoment`, `toggleMomentLike`, `addMomentComment`, `deleteMomentComment` |
| [ ] | `src/services/api/mutation-outcome.ts` | `isAmbiguousMutationFailure` |
| [ ] | `src/services/api/notes.ts` | `notesMutatedSince`, `fetchNotes`, `findCollectedNote`, `fetchNoteDetail`, `fetchNoteDrafts`, `fetchNoteDraft`, `saveNoteDraft`, `deleteNoteDraft`, `importNoteChatMedia`, `createNote`, `updateNote`, `updateNoteGroupIds`, `collectNote`, `setNoteRemark`, `togglePinNote`, `unlistNote`, `relistNote`, `setNoteWorkStatus`, `fetchNoteSourceStates`, `setNoteSourceGroup`, `fetchDeletedNotes`, `purgeNote`, `restoreNote`, `deleteNote`, `createNoteExport`, `fetchNoteGroups`, `createNoteGroup`, `updateNoteGroup`, `deleteNoteGroup`, `reorderNoteGroups` |
| [ ] | `src/services/api/notifications.ts` | `fetchNotificationUnreadSummary`, `markProfileNotificationsRead`, `fetchNotifications`, `fetchNotificationsPage`, `fetchProfileNotifications`, `fetchProfileNotificationsPage`, `markNotificationRead`, `verifyNotificationOpenOwnership`, `markAllNotificationsRead`, `deleteNotification`, `registerPushToken`, `revokePushToken`, `deleteLegacyPushToken`, `fetchCircleOfflinePushEnabled`, `updateCircleOfflinePushEnabled`, `fetchGroupOfflinePushEnabled`, `updateGroupOfflinePushEnabled`, `fetchScrollingAnnouncements`, `fetchProfileNotificationDetail` |
| [ ] | `src/services/api/pagination.ts` | `readHasMore`, `collectOffsetPages`, `collectCursorPages` |
| [ ] | `src/services/api/plaza.ts` | `normalizePlazaPost`, `fetchPlazaFeed`, `fetchPlazaPost`, `createPlazaPost`, `deletePlazaPost`, `reportPlazaPost`, `signupForPost`, `cancelSignup`, `fetchMyCirclePosts`, `fetchAllMyCirclePosts`, `fetchMyPostSignups`, `markMyPostSignupsRead`, `submitPostCollaborationRecognitions`, `fetchMySignupsUnreadCount` |
| [ ] | `src/services/api/privacy.ts` | `fetchPrivacySettings`, `updatePrivacySettings` |
| [ ] | `src/services/api/profile.ts` | `fetchUserProfile`, `updateUserProfile` |
| [ ] | `src/services/api/qr.ts` | `issueQrToken`, `rotateUserQrToken`, `resolveQrToken`, `joinByQrToken` |
| [ ] | `src/services/api/referrals.ts` | `fetchMyReferrals` |
| [ ] | `src/services/api/response-shapes.ts` | `isDisplayIconShape` |
| [ ] | `src/services/api/server-error-codes.ts` | `isKnownServerErrorCode` |
| [ ] | `src/services/api/stickers.ts` | `fetchStickers`, `createSticker`, `removeSticker`, `prepareStickerMessage` |
| [ ] | `src/services/api/support.ts` | `fetchSupportConfig` |
| [ ] | `src/services/api/temp-chat.ts` | `isTempChatOpenable`, `fetchMyTempChats`, `assertMyTempChatConversationOpen`, `createTempChat`, `deleteTempChat`, `endTempChat` |
| [ ] | `src/services/api/upload.ts` | `ensureFilenameExtension`, `sanitizeUploadFilename`, `resolveUploadContentType`, `resolveLocalFileSize`, `requestUploadPresign`, `uploadFileToPresignedUrl`, `uploadLocalFileToPresignedUrl` |
| [ ] | `src/services/api/users.ts` | `pickExactAccountMatch`, `searchUsersByAccountId` |
| [ ] | `src/services/api/utils.ts` | `appendQueryIfDefined`, `buildQuery`, `fetchCountEndpoint`, `allowPeerMediaUrl`, `normalizeMediaUrl`, `normalizeAvatarFrameImageUrl`, `normalizeAvatarFrameAppearance`, `normalizeUserAvatarFrameAppearance`, `normalizeUser` |

## 附录 D：全部后端 Controller 基础追踪覆盖

57个Controller由T3/T4统一覆盖；包含管理端、公共页、webhook，并不代表独立管理Web UI已接入。静态扫描的声明数量需T1 AST重新核对。health/metrics等自监控入口仅分类及可用性验收，默认不建立高频性能trace；webhook先验签、再接受适当上下文，第三方声明不能成为受信任用户身份。

| 状态 | 文件 B/ | Controller参数（静态原文） | 单行HTTP声明数 |
| --- | --- | --- | --- |
| [ ] | `src/admin-access/admin-access.controller.ts` | `'admin/access'` | 8 |
| [ ] | `src/admin-commerce/admin-commerce.controller.ts` | `'admin/commerce'` | 4 |
| [ ] | `src/admin-community/admin-community.controller.ts` | `'admin/community'` | 11 |
| [ ] | `src/admin-console/console.controller.ts` | `'admin/console', 'app-operations', 'ops/read'` | 29 |
| [ ] | `src/admin-content/admin-content.controller.ts` | `'admin/content'` | 4 |
| [ ] | `src/admin-dashboard/dashboard.controller.ts` | `'admin/dashboard'` | 1 |
| [ ] | `src/admin-im/admin-im.controller.ts` | `'admin/im/conversations'` | 5 |
| [ ] | `src/admin-operations/admin-operations.controller.ts` | `'admin/operations'` | 6 |
| [ ] | `src/admin-user/admin-user-resources.controller.ts` | `'admin/users/:userID'` | 6 |
| [ ] | `src/admin-user/admin-user.controller.ts` | `'admin/users'` | 5 |
| [ ] | `src/assistant/assistant.controller.ts` | `'assistant'` | 6 |
| [ ] | `src/auth/auth.controller.ts` | `'auth'` | 35 |
| [ ] | `src/avatar-frame/avatar-frame-admin.controller.ts` | `'admin/avatar-frames'` | 4 |
| [ ] | `src/avatar-frame/avatar-frame.controller.ts` | `'avatar-frames'` | 2 |
| [ ] | `src/call/call-push.controller.ts` | `'calls'` | 1 |
| [ ] | `src/call/call.controller.ts` | `'calls'` | 8 |
| [ ] | `src/call/call.webhook.controller.ts` | `'calls/livekit'` | 1 |
| [ ] | `src/chat/chat.controller.ts` | `'chat'` | 31 |
| [ ] | `src/chat/group-admission.controller.ts` | `'chat'` | 7 |
| [ ] | `src/circle/circle.controller.ts` | `'circle'` | 11 |
| [ ] | `src/circle-invitation/circle-invitation.controller.ts` | `'circle-invitation'` | 12 |
| [ ] | `src/circle-plaza/circle-plaza.controller.ts` | `'circle-plaza'` | 13 |
| [ ] | `src/coin/coin.controller.ts` | `'coin'` | 3 |
| [ ] | `src/collection/collection.controller.ts` | `'collections'` | 3 |
| [ ] | `src/conversation-group/conversation-group.controller.ts` | `'conversation-groups'` | 5 |
| [ ] | `src/credit/credit.controller.ts` | `'credit'` | 1 |
| [ ] | `src/fancy-number/fancy-number-admin.controller.ts` | `'admin/mall/fancy-numbers'` | 7 |
| [ ] | `src/fancy-number/fancy-number.controller.ts` | `'mall/fancy-numbers'` | 8 |
| [ ] | `src/friend/friend-report-admin.controller.ts` | `'admin/friend-reports'` | 2 |
| [ ] | `src/friend/friend.controller.ts` | `'friend'` | 26 |
| [ ] | `src/geo/geo.controller.ts` | `'geo'` | 2 |
| [ ] | `src/group/group.controller.ts` | `'group'` | 5 |
| [ ] | `src/group-expansion/group-expansion.controller.ts` | `'group-expansions'` | 2 |
| [ ] | `src/icon/icon.controller.ts` | `'icon'` | 2 |
| [ ] | `src/like/like.controller.ts` | `'user'` | 2 |
| [ ] | `src/mall/mall.controller.ts` | `'mall'` | 1 |
| [ ] | `src/membership/membership-admin.controller.ts` | `'admin/memberships/users'` | 1 |
| [ ] | `src/membership/membership-program-admin.controller.ts` | `'admin/memberships/program'` | 1 |
| [ ] | `src/membership/membership.controller.ts` | `'membership'` | 2 |
| [ ] | `src/moderation/moderation-admin.controller.ts` | `'admin/moderation'` | 6 |
| [ ] | `src/note/note-share-link-public.controller.ts` | `'note'` | 2 |
| [ ] | `src/note/note.controller.ts` | `'note'` | 34 |
| [ ] | `src/notification/notification-admin.controller.ts` | `'admin/system-announcements'` | 5 |
| [ ] | `src/notification/notification-public.controller.ts` | `'notification'` | 1 |
| [ ] | `src/notification/notification.controller.ts` | `'notification'` | 16 |
| [ ] | `src/privacy/privacy-settings.controller.ts` | `'privacy'` | 2 |
| [ ] | `src/qr/qr.controller.ts` | `'qr'` | 5 |
| [ ] | `src/referral/referral.controller.ts` | `'referrals'` | 1 |
| [ ] | `src/sensitive-word/sensitive-word-admin.controller.ts` | `'admin/sensitive-words'` | 3 |
| [ ] | `src/sticker/sticker.controller.ts` | `'stickers'` | 4 |
| [ ] | `src/support/support-admin.controller.ts` | `'admin/support'` | 3 |
| [ ] | `src/support/support.controller.ts` | `'support'` | 1 |
| [ ] | `src/support-recharge/support-recharge-admin.controller.ts` | `'admin/support/recharge'` | 7 |
| [ ] | `src/temp-chat/temp-chat.controller.ts` | `'temp-chat'` | 10 |
| [ ] | `src/trace/trace.controller.ts` | `'trace'` | 8 |
| [ ] | `src/upload/upload.controller.ts` | `'upload'` | 1 |
| [ ] | `src/user/user.controller.ts` | `'user'` | 6 |

## 附录 E：非 HTTP 的后端执行入口

T8/T12/T14逐个分类。共享被调用service不额外建重复根span。定时装饰器、动态注册队列等仍由T1 AST漂移检查补充发现，不把此快照当运行时调用图。

| 状态 | 文件 B/ | 归属 |
| --- | --- | --- |
| [ ] | `src/admin-community/admin-group-operation.processor.ts` | T14 |
| [ ] | `src/admin-console/console-insights.service.ts` | T14 |
| [ ] | `src/admin-user/session-revocation-outbox.processor.ts` | T14 |
| [ ] | `src/assistant/assistant-alert-delivery.processor.ts` | T14 |
| [ ] | `src/auth/refresh-token.cleanup.ts` | T14 |
| [ ] | `src/auth/refresh-token.service.ts` | T14 |
| [ ] | `src/call/call.cleanup.ts` | T14 |
| [ ] | `src/chat/chat-burn-archive-cleanup.service.ts` | T14 |
| [ ] | `src/chat/chat-burn-sweeper.service.ts` | T14 |
| [ ] | `src/chat/chat-circle-sync.service.ts` | T14 |
| [ ] | `src/chat/chat-direct-auto-reply.processor.ts` | T14 |
| [ ] | `src/chat/chat-support-recharge.processor.ts` | T14 |
| [ ] | `src/chat/chat.gateway.ts` | T8/T12/T14 |
| [ ] | `src/circle-invitation/circle-invitation.service.ts` | T14 |
| [ ] | `src/circle-plaza/circle-plaza.cleanup.ts` | T14 |
| [ ] | `src/coin/gift-card-outbox.processor.ts` | T14 |
| [ ] | `src/coin/wallet-reconciliation.service.ts` | T14 |
| [ ] | `src/fancy-number/fancy-number.cleanup.ts` | T14 |
| [ ] | `src/friend/friend-chat-replay-outbox.processor.ts` | T14 |
| [ ] | `src/like/like-reconciliation.service.ts` | T14 |
| [ ] | `src/metrics/outbox-depth.service.ts` | T14 |
| [ ] | `src/note/note-recycle-bin.cleanup.ts` | T14 |
| [ ] | `src/note/note-share-link.cleanup.ts` | T14 |
| [ ] | `src/note/note-status-fanout-outbox.processor.ts` | T14 |
| [ ] | `src/notification/notification-push-outbox.processor.ts` | T14 |
| [ ] | `src/notification/notification-push.service.ts` | T14 |
| [ ] | `src/notification/notification-retention.cleanup.ts` | T14 |
| [ ] | `src/realtime/realtime.gateway.ts` | T8/T12/T14 |
| [ ] | `src/referral/referral.service.ts` | T14 |
| [ ] | `src/temp-chat/temp-chat.cleanup.ts` | T14 |
| [ ] | `src/upload/storage-audit.service.ts` | T14 |

## 附录 F：当前已出现遥测调用的功能文件

以下只证明源码存在reportError/reportHandledFailure/logClientDiagnostic/startOperationSpan调用，不证明已是分布式trace。执行对应功能任务时先复用、消除重复，禁止因为存在旧调用就跳过链路验收。

### app-update

- `src/features/app-update/AppUpdateHost.tsx`
- `src/features/app-update/ota-health.ts`

### assistant

- `src/features/assistant/screens/AssistantChatScreen.tsx`

### auth

该目录无这四种调用的静态匹配；公共层覆盖与其他埋点仍需按矩阵核对。

### call

- `src/features/call/call-session-teardown.ts`
- `src/features/call/hooks/use-call-reconciliation.ts`
- `src/features/call/livekit-module.ts`
- `src/features/call/livekit-module.web.ts`
- `src/features/call/push/incoming-call-actions.ts`
- `src/features/call/push/use-call-push-bridge.ts`
- `src/features/call/push/use-ringing-call-watchdog.ts`
- `src/features/call/screens/GroupCallScreen.tsx`

### chat

- `src/features/chat/chat-detail/helpers.ts`
- `src/features/chat/chat-detail/hooks/use-chat-call.ts`
- `src/features/chat/chat-detail/hooks/use-chat-conversation.ts`
- `src/features/chat/chat-detail/hooks/use-chat-timeline.ts`
- `src/features/chat/chat-detail/hooks/use-collect-message.ts`
- `src/features/chat/chat-detail/hooks/use-composer-input.ts`
- `src/features/chat/chat-detail/hooks/use-media-send.ts`
- `src/features/chat/chat-detail/hooks/use-note-batch-send.ts`
- `src/features/chat/chat-detail/hooks/use-note-card-status-sync.ts`
- `src/features/chat/chat-detail/hooks/use-voice-recording.ts`
- `src/features/chat/components/bubbles/image-bubble.tsx`
- `src/features/chat/components/bubbles/video-bubble.tsx`
- `src/features/chat/components/bubbles/voice-bubble.tsx`
- `src/features/chat/screens/ChatHistoryDateResultsScreen.tsx`
- `src/features/chat/screens/ChatHistoryDateScreen.tsx`
- `src/features/chat/screens/ChatHistoryFilesScreen.tsx`
- `src/features/chat/screens/ChatHistoryMediaScreen.tsx`
- `src/features/chat/screens/ChatHistoryTextScreen.tsx`
- `src/features/chat/screens/ChatInfoScreen.tsx`
- `src/features/chat/screens/EditGroupNoticeScreen.tsx`
- `src/features/chat/screens/ForwardPickerScreen.tsx`
- `src/features/chat/screens/GroupLogScreen.tsx`
- `src/features/chat/screens/GroupManageScreen.tsx`
- `src/features/chat/screens/InviteGroupMembersScreen.tsx`
- `src/features/chat/screens/NewGroupScreen.tsx`
- `src/features/chat/screens/RecommendFriendScreen.tsx`
- `src/features/chat/screens/SharePickerScreen.tsx`
- `src/features/chat/utils/note-card-fresh-status.ts`

### contacts

- `src/features/contacts/screens/ContactsScreen.tsx`
- `src/features/contacts/screens/FriendActivityDetailScreen.tsx`
- `src/features/contacts/screens/GroupsScreen.tsx`
- `src/features/contacts/utils/mark-friend-activities-read.ts`

### discover

- `src/features/discover/components/moment-comment-input.tsx`
- `src/features/discover/components/moments-feed.tsx`
- `src/features/discover/hooks/use-change-circle-cover.ts`
- `src/features/discover/hooks/use-change-cover.ts`
- `src/features/discover/hooks/use-circle-notification-tiers.ts`
- `src/features/discover/screens/AdminReviewScreen.tsx`
- `src/features/discover/screens/CircleDetailScreen.tsx`
- `src/features/discover/screens/CreateCircleScreen.tsx`
- `src/features/discover/screens/CreateMomentScreen.tsx`
- `src/features/discover/screens/EditCircleScreen.tsx`
- `src/features/discover/screens/InvitationVerificationScreen.tsx`
- `src/features/discover/screens/InviteToCircleScreen.tsx`
- `src/features/discover/screens/MomentDetailScreen.tsx`
- `src/features/discover/screens/SelectVerifierScreen.tsx`
- `src/features/discover/screens/ShareCircleCardScreen.tsx`
- `src/features/discover/screens/UserMomentsScreen.tsx`
- `src/features/discover/screens/VerificationRequestScreen.tsx`
- `src/features/discover/store/use-moments-store.ts`

### explore

该目录无这四种调用的静态匹配；公共层覆盖与其他埋点仍需按矩阵核对。

### groups

- `src/features/groups/GroupAdmissionsList.tsx`
- `src/features/groups/GroupEntryScreen.tsx`

### location

- `src/features/location/components/amap-native-surface.tsx`
- `src/features/location/services/geocode-failure-reporting.ts`

### messages

- `src/features/messages/screens/MessagesScreen.tsx`
- `src/features/messages/screens/ScanScreen.tsx`
- `src/features/messages/screens/TempChatsScreen.tsx`
- `src/features/messages/store/use-message-groups-store.ts`

### notes

- `src/features/notes/components/GroupManagerSheet.tsx`
- `src/features/notes/components/NoteBlockEditor.tsx`
- `src/features/notes/components/NoteCard.tsx`
- `src/features/notes/components/NoteGroupPickerSheet.tsx`
- `src/features/notes/components/NoteVideoViewer.tsx`
- `src/features/notes/screens/DraftsScreen.tsx`
- `src/features/notes/screens/EditNoteScreen.tsx`
- `src/features/notes/screens/NoteDetailScreen.tsx`
- `src/features/notes/screens/NoteManagementScreen.tsx`
- `src/features/notes/screens/RecycleBinScreen.tsx`
- `src/features/notes/screens/UnlistedNotesScreen.tsx`
- `src/features/notes/utils/note-editor-drafts.ts`

### notifications

- `src/features/notifications/components/NotificationSnackbarHost.tsx`
- `src/features/notifications/components/PushNotificationRouteHandler.tsx`
- `src/features/notifications/screens/NotificationCenterScreen.tsx`
- `src/features/notifications/screens/PostSignupsScreen.tsx`
- `src/features/notifications/services/jpush.ts`
- `src/features/notifications/services/push-token-registration.ts`
- `src/features/notifications/utils/report-failure.ts`
- `src/features/notifications/utils/seen-target.ts`

### profile

- `src/features/profile/components/ScrollingAnnouncements.tsx`
- `src/features/profile/hooks/use-credit-events.ts`
- `src/features/profile/screens/AboutVersionScreen.tsx`
- `src/features/profile/screens/AccountSecuritySettingsScreen.tsx`
- `src/features/profile/screens/AppSettingsScreen.tsx`
- `src/features/profile/screens/ChangePasswordScreen.tsx`
- `src/features/profile/screens/CollectionsScreen.tsx`
- `src/features/profile/screens/MemberCenterScreen.tsx`
- `src/features/profile/screens/NotificationSettingsScreen.tsx`
- `src/features/profile/screens/ProfileScreen.tsx`
- `src/features/profile/screens/SettingsScreen.tsx`
- `src/features/profile/screens/ShareScreen.tsx`
- `src/features/profile/screens/SupportAgentsScreen.tsx`
- `src/features/profile/screens/SystemAnnouncementDetailScreen.tsx`
- `src/features/profile/screens/SystemPermissionsScreen.tsx`
- `src/features/profile/screens/WalletScreen.tsx`

### qr

该目录无这四种调用的静态匹配；公共层覆盖与其他埋点仍需按矩阵核对。

### search

- `src/features/search/screens/SearchScreen.tsx`

### security

- `src/features/security/store/login-approval-store.ts`

### social

- `src/features/social/screens/AddFriendScreen.tsx`
- `src/features/social/screens/CreatePostScreen.tsx`

### user

- `src/features/user/screens/EditFriendPermissionScreen.tsx`
- `src/features/user/screens/EditFriendRemarkScreen.tsx`
- `src/features/user/screens/UserProfileScreen.tsx`

<!-- GENERATED_INVENTORY_END -->
