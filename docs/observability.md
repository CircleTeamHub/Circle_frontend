# Circle 全链路监控与排障

前端使用现有 Sentry，不新增独立日志上传服务；后端提供 Prometheus/Grafana/Alertmanager 配置，Loki/Alloy 为可选组件。代码接入、运行时上报、源码映射和告警投递需要分别验收。

2026-11-04 核查与部署：`windnote/react-native` 已收到真实 App 事件，包含 `production` 的 iOS adhoc 包；[REACT-NATIVE-71](https://windnote.sentry.io/issues/7725853141/) 中有路由边界捕获的 `pause` 异常。该事件尚无匹配的 source-map artifacts，堆栈显示 `main.jsbundle:1:<列号>`。服务器指标、看板和日志栈现已部署；生产后端配置仍未启用 Sentry，这与手机 App 的 Sentry 接入状态不同。

## 如何阅读 App 报错

`REDACTED` 表示原始文本被脱敏。新版上报改用固定的中文故障说明，不再把整个标题替换为占位符。例如：

```text
页面显示或退出失败｜原生资源已释放或不可用
页面跳转：/(tabs)/profile/collections → /(tabs)/profile
请求完成｜GET /collections｜HTTP 200｜85 ms
```

- 标题保留故障类型、已有的组件/操作信息；原生共享资源失效、类型错误、请求超时等使用固定说明，不上传任意异常原文。
- Breadcrumbs 的导航记录保留归一化的 `from/to`，HTTP 记录保留方法、接口模板和状态码；不上传页面参数、完整 URL、请求正文或界面文字。
- Additional Data → `navigationHistory` 单独保存最近 20 次页面跳转（中文说明、时间戳、来源和目标页面），不会被频繁的接口记录挤掉。
- Additional Data → `clientDiagnostics` 的最近 20 条记录包含中文 `summary` 和毫秒时间戳 `timestamp`；手动上报和 SDK 自动捕获的 JS 异常都会附带。接口、耗时和 `requestId` 可用于串联后端日志。
- Tags 中 `currentRoute` 是当前页面模板，`previousRoute` 是上一页面模板。左上角返回会留下“点击左上角返回”记录，收藏页另记选择模式返回、批量操作和内容打开；不记录页面标题、参数或收藏内容。
- 页面异常按堆栈进行分组，避免不同页面的不同根因全部挤进 `render/route` 同一个 issue。
- 历史事件中已被替换的内容无法恢复。需要安装含新代码的 App 并产生新事件，才能看到新版格式；源码文件/行号还需要上传**同一次构建**的 source maps，私有上传 token 不得放入客户端公开变量。

## 按用户定位报错和操作路径

本轮按用户明确要求，把认证状态里的 **`AuthUser.id` 内部用户 ID** 关联到 Sentry 的 `user.id`。这不是昵称、邮箱或展示用账号；不额外上传这些个人资料。登录/恢复会话时设置身份，切换账号时更新，退出时清空；资料刷新不重置历史。认证订阅在状态变化时同步更新，不等待下次页面 effect。账号改变会清空 SDK 面包屑、本地诊断和页面历史，避免沿用上一账号的操作记录。手动错误捕获身份与路径快照；晚处理的自动事件不借用另一账号的当前诊断，旧会话的 HTTP/上传失败也不会归到新会话。

1. 打开 [App Sentry Issues](https://windnote.sentry.io/issues/?project=4511629384220672&statsPeriod=24h)，选择对应环境和故障时间。
2. 搜索 `user.id:内部用户ID`。例如 `user.id:6f987e2d-0123-4567-89ab-0123456789ab`。查已解决的问题时移除 `is:unresolved` 等额外条件；一个 issue 可以合并多个用户的同类异常，需要进入该 issue 选择对应用户的事件。
3. 在事件的 **User → ID** 核对用户，在 **Breadcrumbs** 看捕获到的页面跳转、请求和触摸；**Additional Data → navigationHistory** 看最近 20 次页面路径，**clientDiagnostics** 看最近 20 条业务/请求记录，包括左上角返回、收藏操作与安全请求元数据。
4. 看 `currentRoute` / `previousRoute`、`operation` / `kind`、堆栈和 `requestId`，需要时再去 Grafana/Loki 串联后端请求。

这些是错误发生前的有限诊断线索，不是每次点击的完整审计，也没有开启录屏。通用触摸仅记录“用户触摸界面”，具体操作依靠已有业务埋点。身份关联和新轨迹需要发布含这些改动的 App 后才会产生；旧事件无法补上当时没有上传的用户 ID。

## 前端也需要总览

当前 Grafana 四张看板展示服务端数据。手机本地的渲染异常、崩溃、弱网耗时和页面卡顿，需要客户端遥测；本项目继续使用已接入的 Sentry，不新增一套采集 SDK。

| 想知道的问题 | 查看位置与信号 |
| --- | --- |
| 哪个用户、哪个版本在哪个页面报错 | Sentry Issues，按 `user.id`、environment、release、页面和操作筛选 |
| App 是否经常崩溃 | Sentry Releases / Release Health 的会话与崩溃趋势；自动会话采集已开启 |
| 启动或页面打开慢不慢 | Sentry 性能数据中的移动端启动、导航/页面事务；生产 trace 采样率为 5% |
| 用户侧请求/消息/上传的耗时和失败趋势 | Sentry Metrics 的 `api.request.duration`、`app.operation.duration`；推送和通话还有各自指标 |
| 服务器、数据库、队列和公网入口是否正常 | 现有 Grafana 服务端看板 |

因此，前端总览可以放在 Sentry；不要求 Grafana 同时再有一张前端看板。若后续需要统一运维大屏，再接入已有客户端数据源，避免重复采集。上表说明代码已接入的信号与查询方向，未声称本轮已在 Sentry 账户中新建远程 Dashboard；新包上报、性能/指标真实到达和账户可用功能仍需验收。用户 ID 仅用于错误/事务事件，不加入 Sentry Metrics 或 Prometheus 的聚合标签。

## 本轮补足的 App 覆盖

| 路径 | 补足的信号 |
| --- | --- |
| 自动 JS 异常、未处理 Promise | 本地诊断时间线、当前/上一页面；未处理 Promise 的限流每分钟恢复，避免达到上限后永久失明 |
| 所有经过 apiClient 的请求 | `api.request.duration` 分布指标：固定 HTTP 方法、审核过的路由模板、success/http/api-code/network/timeout/body-read/invalid-json/unexpected 结果；包含正常 4xx，且不为正常拒绝额外建立 issue |
| API 数据结构校验 | `expectShape` 失败在边界捕获一次 `ResponseShapeError`；保留调用堆栈，不上传返回数据；业务 catch 避免重复上报 |
| 聊天发送、socket 建连、对象存储上传 | `app.operation.duration`，按 chatSend/chatConnect/mediaUpload 和 success/failed/cancelled 聚合；与 5% trace 采样独立，上传重试每次都有结果 |
| 创建、编辑、添加笔记 | `app.operation.duration`，按 noteCreate/noteUpdate/noteCollect 和 success/failed 聚合；创建/编辑从有效提交开始统计准备、请求和结果校验，添加从确认按钮开始统计来源恢复及收藏请求，不包含用户填写或选择分组的时间 |
| 登录、注册、设备验证后的会话建立 | 补原生存储/状态等非 HTTP 失败；注册保留 request/session 阶段 |
| 收藏 | 加载、批量操作、语音播放失败；保存相册失败在媒体工具入口捕获 |
| 笔记、草稿、回收站、下架笔记 | 本地/远端草稿保存、录音持久化与恢复、损坏草稿 JSON、删除重试、恢复/上下架等遗漏的已处理失败 |
| 录音与推送配置 | 录音结束/保存、音频模式恢复、通知渠道准备、Expo project ID 缺失、已选 JPush 的原生模块加载失败 |

已有聊天同步/SQLite、LiveKit 连接与断开、推送 token 注册撤销与通知路由上报继续沿用。用户取消、权限拒绝、浏览器正常降级和已释放原生对象的预期清理不作为新增故障。

Sentry Issues 用于定位异常：先按 `currentRoute`/`previousRoute` 筛选，再看 `operation`/`kind`、`clientDiagnostics`、调用堆栈。客户端指标在 Sentry Metrics 中查看：`api.request.duration` 按 route/outcome 比较请求量和耗时，`app.operation.duration` 按 operation/outcome 比较成功与失败；HTTP 指标统计的是每次网络尝试，401 后刷新/重试会分别计入。它们不等于一次用户操作的数量。

笔记保存的 `note.save.phase` 诊断分别记录 prepare/request/reconcile，详情页添加笔记的 `note.collect.phase` 记录 source/request。阶段诊断只携带阶段名和毫秒耗时，不记录正文、名片、笔记或消息标识。总操作耗时与 `/note`、`/note/:id`、`/note/collect` 的 HTTP 耗时结合查看，以区分准备开销、客户端网络等待和结果处理；服务端耗时需要对照 Prometheus，不能用客户端 HTTP 耗时直接代替。

客户端指标发往 Sentry；服务器上的 Prometheus/Grafana 负责服务端指标，不能直接读到手机上的本地故障。指标 SDK 缺失、DSN 未配置、离线进程退出或额度限制时不能保证到达。本轮离线测试验证了指标生成与最终脱敏钩子，真实 Sentry 到达和源码映射仍需安装新包后验收。

已处理失败、通知、聊天发送和聊天事件分发的去重均改为 60 秒窗口，持续故障会重新可见；去重后的 issue 事件数仍不是精确失败次数。可选的诊断缓冲出错不会阻断异常上报。

## 已部署服务器的访问方式

服务器 Compose 项目为 `circle-monitoring`，11 个服务运行中，14/14 抓取目标 UP。已验收 PostgreSQL/Redis、公网 HTTPS 健康探测、应用容器 CPU/内存、四张看板和新日志到达 Loki；未将容器文件系统用量纳入已验收覆盖范围，主机磁盘指标可用。服务随 Docker 开机恢复，数据保存在持久卷中。

入口仅绑定服务器 `127.0.0.1`。在电脑终端建立隧道后访问：

```sh
ssh -N -o ExitOnForwardFailure=yes -L 3001:127.0.0.1:3001 -L 9090:127.0.0.1:9090 -L 9093:127.0.0.1:9093 circle-singapore
```

命令成功后通常停在空白行，不显示“完成”提示，也不会自动打开网页。保持该终端运行，再在浏览器打开 `http://localhost:3001/`。按 Ctrl+C 或关闭终端会断开隧道。若只转发了 `3001`，则只能访问 Grafana；Prometheus 和 Alertmanager 还需上面另外两个端口的转发。

| 页面 | 电脑上的地址 | 用途 |
| --- | --- | --- |
| Grafana | http://localhost:3001 | 四张看板；Explore → Loki 查日志 |
| Prometheus | http://localhost:9090 | 查询指标、Status → Targets 查抓取状态 |
| Alertmanager | http://localhost:9093 | 查看当前告警和抑制状态 |

Grafana 用户名为 `admin`；随机密码保存在服务器 `/home/ubuntu/circle_be/monitoring/.env` 的 `GRAFANA_ADMIN_PASSWORD`，文件权限为 0600。服务器操作说明和无秘密验收回执分别位于 `/home/ubuntu/.config/circle-monitoring/README.md`、`deployment-receipt.json`。

本机覆盖文件 `/home/ubuntu/.config/circle-monitoring/compose.host.yml` 固定了兼容 Docker 29/containerd 的官方 cAdvisor 0.60.6 镜像摘要，未增加原有挂载或特权；既有发版同步会沿用该覆盖文件。首次历史日志回填有时间顺序/限流拒收，原日志文件保留，新日志链路已实测通过。

**Discord 接入：**沿用「搞钱工作群」现有频道和 Webhook，未新建频道或 Webhook。Sentry 继续向 `#sentry` 发送 App 告警；GitHub CI/PR/发版继续使用原有通知。服务器一般故障发往 `#alertmanager`，公网可用性、TLS 证书及黑盒探测故障发往 `#uptime`。

旧 `#alertmanager` 记录中的目标是本机 Docker 的 `host.docker.internal:3000`；旧 `#uptime` 有 Uptime Kuma 测试通知。此次把这两个既有频道接到已部署服务器：复用原 `alert` 和 `uptime 警告` Webhook，公网探测使用当前仓库已有的 blackbox exporter，不另启 Uptime Kuma。保留全部 12 条告警抑制规则，Watchdog 不混入普通 Discord 告警。

活动配置为 `/home/ubuntu/.config/circle-monitoring/alertmanager-discord.yml`，由同目录 `compose.host.yml` 覆盖文件加载，直接只读挂载到容器 `/run/config/circle-alertmanager.yml`。两个既有 Webhook 分别保存在 `discord.url`、`discord-uptime.url`，只读挂载到容器 `/run/secrets/circle-monitoring-discord.url`、`/run/secrets/circle-monitoring-discord-uptime.url`；凭据不写入业务发版目录、仓库、聊天或日志。配置目录为 0700，凭据为 0640、组 65534，供容器的 `nobody` 用户只读。配置和凭据不再嵌套挂载于仓库目录之下，避免目录更新使挂载路径失效。发版同步会保留该主机覆盖文件。

已通过配置校验、critical/warning/uptime/Watchdog 路由测试，两个频道均实收标有“非业务故障”的测试告警和对应恢复通知，测试告警已全部恢复。Discord 消息实收及恢复验收记录保存在同目录 `discord-delivery-test.json`，接入状态记录为 `discord-setup-status.json`。

**待配置：**独立于该服务器的外部 Watchdog、合成探测专用测试账号、备份自检指标。公网 blackbox 探测运行在业务服务器上，不能在整台主机断电时自行发出通知；该场景仍需外部心跳接收服务。部署时已观察到固定验证码旁路开启、私有媒体桶策略未确认及 `note_status_fanout` 队列积压告警，需另行处理对应业务配置/状态。

## 各层各自回答什么问题

Grafana 欢迎页不会自动展示项目数据。点左侧 **Dashboards**，或使用下面四个入口；日常先打开运行总览，时间范围选最近 30 分钟、自动刷新 30 秒。排查历史问题时把时间范围改为故障前后 5～10 分钟，图中的横轴就是时间，纵轴单位以面板标注为准。

| 入口 | 主要看什么 |
| --- | --- |
| [运行总览](http://localhost:3001/d/circle-be-operations/circle-be-e28094-operations-overview?from=now-30m&to=now&refresh=30s) | 当前告警、采集目标、公网探测、内存和磁盘；up/probe_success 为 1 表示通过，0 表示失败。采集正常不代表业务和安全告警全部正常 |
| [接口与聊天](http://localhost:3001/d/circle-be-red/circle-be-e28094-red?from=now-30m&to=now&refresh=30s) | 每秒请求、5xx 比例、接口 p95、聊天连接和发送耗时；p95 表示约 95% 的请求耗时不超过该值，秒乘 1000 为毫秒 |
| [任务、队列和数据库](http://localhost:3001/d/circle-be-jobs/circle-be-e28094-jobs-queues-and-datastores?from=now-30m&to=now&refresh=30s) | 定时任务心跳和失败、积压、最老任务年龄、死信、数据库连接池及锁；积压持续增长或最老任务一直变老需要排查 |
| [推送、上传和通话](http://localhost:3001/d/circle-be-deliveries/d863eba?from=now-30m&to=now&refresh=30s) | 对象存储、验证码邮件、推送、上传授权、通话建立及 LiveKit 回调 |

查后端日志：左侧 **Explore → Loki → Code**，输入以下查询，选择故障对应时间，点 **Run query**：

```logql
{service="circle-be"} | json | level=~"error|warn"
```

要查全部后端日志，使用 `{service="circle-be"}`；要串联 Sentry 的一次 HTTP 请求，在 `| json` 后加 `| requestId="对应UUID"`。本机 App 的渲染/原生资源异常先去 Sentry 看路由、诊断时间线与堆栈，后端 Grafana 不会自动收到手机本地堆栈。

`No data` 表示当前时间范围没有符合查询的数据，不能当成 0 或健康：可能没有发生对应业务（如没有通话）、错误状态的时间序列尚未产生、该能力尚未配置，或采集异常。先看运行总览的采集状态，再确认对应功能是否已启用。

| 层 | 工具/信号 | 用途与边界 |
| --- | --- | --- |
| 客户端错误 | Sentry JS、路由 ErrorBoundary、已处理失败上报、原生崩溃 | 按内部 user.id 定位已收到的用户异常与页面路径；常见业务拒绝不报，原生边界见下文 |
| 客户端请求过程 | 最近 20 条本地诊断面包屑 | 每次 HTTP 尝试记录安全路由、method/status、耗时、requestId、结果；单独记日志不上传 |
| 服务端错误 | Sentry + Nest 全局异常处理 + 进程/启动兜底 | HTTP 5xx、任务/依赖异常、启动失败、未处理异常；保留脱敏机制标记及跟踪 ID |
| 服务端运行日志 | Winston JSON + 可选 Loki/Alloy | 根据 requestId 或 job/runId 检索请求、慢操作和后台任务；不是无限期审计档案 |
| 接口与业务指标 | Prometheus + Grafana `circle_be — RED` | 流量、错误率、延迟、在线连接、业务事件；不把账号/requestId放进指标标签 |
| 后台任务与队列 | Grafana `circle_be — Jobs, Queues & Datastores` | 各任务心跳/失败、outbox积压和死信；查询使用抓取后的 exported_job 区分任务 |
| 主机、依赖、公网 | node-exporter、cAdvisor、Postgres/Redis exporter、blackbox | 资源余量、依赖可用性、DNS/TLS/入口可达性；部分只存在于生产 overlay |
| 监控系统自身 | Grafana `circle_be — Operations Overview` + Alertmanager + 外部 Watchdog | 抓取健康、规则执行、投递失败、日志重试/丢弃、监控栈整体失联 |

后端实施说明在后端仓库 `docs/observability.md`、`monitoring/README.md` 与 `monitoring/logs.md`。四张 Grafana 看板由现有 provisioning 自动加载，需按既有部署流程更新配置。

## 用一次错误串起前后端

1. 在前端 Sentry 选择正确 `environment`、`release`、`dist`，先看稳定 fingerprint、路由、状态和 `failureKind`。
2. HTTP 错误的 `requestId` 是一条请求的随机 UUID。前端发送 `X-Request-Id`，后端回传；收到合法 UUID 后优先使用回传值。网络完全不通时只有客户端 ID，后端可能根本没有该条请求。
3. 同一次 401 → refresh → retry **分别生成不同 ID**。刷新失败会关联 `/auth/refresh`，而不是冒充原始业务接口失败。ID不进入 fingerprint。
4. 用对应 ID 查询后端 JSON/Loki：`{service="circle-be"} | json | requestId="<uuid>"`。Sentry/WebSocket traceId 和 HTTP requestId 含义不同；本轮没有声称完成自动分布式 tracing。
5. 对后台任务，使用 Sentry 的 `job`/`runId` 查同次任务日志，并在 Jobs 面板核对 `exported_job` 的心跳与失败趋势。

每次请求完成都会保留本地诊断；慢请求阈值为 2 秒。相同安全路由/method/status/apiCode/failureKind 的 Sentry API 事件最多每分钟一次，最多 100 个记账键（含溢出桶）。这是防止离线重试耗尽配额，**不是准确失败次数统计**。退出账号清空缓冲与限流记账；旧会话迟到的请求不会污染新会话诊断。

## 隐私和噪声

- HTTP 开发日志也不再输出请求/响应正文、自定义请求头、查询键值或原始异常文本。旧 `logResponseBody` 参数保留类型兼容，但不能打开正文日志。
- HTTP 路由按 `src/observability/http-diagnostics.ts` 中审核过的模板归一化；未知路径直接 `/__other__`，纯字母 ID 和 QR bearer token 也不会原样保留。新增接口时维护模板；漏配只降低分组精度，不放开原始路径。
- 按本轮明确授权，仅发送内部 `user.id` 用于按用户排障；邮箱、昵称、手机号、IP 等身份字段仍过滤。用户 ID 与 requestId 都是可关联的运维数据，Sentry/Loki需要访问控制、合理保留期和团队授权。
- 截图、view hierarchy、失败请求自动抓取关闭，Replay采样率为0。正常本地诊断不构成单独的上传事件。
- JavaScript `beforeSend`/breadcrumb/span sanitizer 只保证经过 JS SDK 的事件。**React Native原生SDK独立生成的崩溃事件不经过这些JS钩子**；仍保留原生崩溃上报。原生异常消息的彻底过滤需单独验收原生钩子或 Sentry 服务端清洗，不能把 `sendDefaultPii:false` 当成所有字段都已脱敏的证明。
- `preprod` 构建变体使用独立的 `preproduction` 环境；生产默认采样 5% 性能 trace。只保留白名单数值性能测量和合法 trace/span ID，不上传任意 span 描述或上下文。

## 上线前验收（本轮未执行）

- 在批准的构建环境填写 DSN/release/dist、私有 source-map 上传凭据；私有 token 绝不使用 `EXPO_PUBLIC_`。缺少 DSN 时客户端不初始化 Sentry。
- 重建预生产 App，分别验证 JS渲染异常、已处理失败和**原生崩溃**的真实到达、归组、源码位置和隐私清洗。测试后关闭测试开关，不在真实用户会话故意触发崩溃。
- 用测试账号登录，在收藏页进入/返回后捕获可控错误，验证 `user.id` 搜索及 `navigationHistory` / `clientDiagnostics`；切换账号及退出后再次验证没有混入上一账号记录。
- 后端配置 `LOG_AGGREGATION_PROVIDER=sentry`、`SENTRY_DSN` 和 release；本地 `.js.map` 随镜像保留。Node本地映射不等于已上传 Sentry artifacts，完整源码上下文仍要验收发布流程。
- Prometheus Targets 中检查应用/依赖、Alertmanager，及启用日志 overlay 后的 Loki/Alloy；**未启用的可选组件显示 No data，不等于健康**。
- 从批准的测试环境触发一条可恢复告警，确认真实接收人收到并能看到恢复通知；再验证外部 Watchdog 的失联通知。通过已经损坏的接收器发送“接收器坏了”的告警并不能保证送达。
- 真正的 API/登录/上传/聊天/通知/通话 E2E 需要预生产依赖与测试账号；离线单测不能替代它。

## 参考依据

- [Expo 环境变量必须静态读取](https://docs.expo.dev/guides/environment-variables/)
- [Sentry React Native 7.11 原生桥接边界](https://github.com/getsentry/sentry-react-native/blob/7.11.0/packages/core/src/js/wrapper.ts)
- [Prometheus 抓取标签冲突规则](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config)
- [Alloy 日志发送重试/丢弃指标](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.write/#debug-metrics)

## 笔记操作耗时

app.operation.duration 记录创建、编辑、添加笔记的总操作耗时（毫秒），按 noteCreate / noteUpdate / noteCollect 及 success / failed 聚合。创建和编辑从有效提交开始，添加从确认按钮开始，不包含用户填写内容或选择分组的时间。

本地 note.save.phase 诊断分别记录 prepare / request / reconcile，详情页的 note.collect.phase 记录 source / request；只记录阶段名和毫秒耗时，不记录正文、名片、笔记或消息标识。结合现有 HTTP 诊断和服务端 Prometheus 区分客户端准备、网络等待和结果处理；客户端 HTTP 耗时包含网络开销，不能直接当作服务端处理时间。

新指标需要发布新客户端并启用现有 Sentry 配置后才能观察；本地合成正文的 CPU/体积基准不能代替手机端到端验收。
