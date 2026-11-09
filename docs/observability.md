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

前端使用现有 Sentry，不新增独立日志上传服务；后端使用 Prometheus/Grafana/Alertmanager 与 Loki/Alloy。本文描述代码能力，实际启用情况须按构建和服务器核对，不能把代码合入当作采集已经到达。2026-11-05 只读核对预生产主机：Loki/Alloy 正在运行，Loki 查询保留期为 168 小时；下述新增的本地退出档案和复制入口需要包含该改动的新 App 构建。

## 自动退出登录诊断

清理凭证、账号作用域和内存面包屑之前，先生成随机 `diagnosticId`，将固定原因和最近的 HTTP 尝试保存到设备独立的 AsyncStorage key `circle-im-session-diagnostics-v1`。自动退出同时上报 `operation=session`、`kind=forcedLogout`，Sentry 的 `diagnosticId` 与本地记录的 `id` 相同。续期的 2xx 响应异常也保存档案，并以 `kind=refreshResponseInvalid` 单独上报；续期后的 401 若复用原响应 ID，则以 `kind=authRetryResponseReplayed` 上报。这两条异常路径保留登录态。上述三种事件绕开通用失败及 SDK 的相同错误去重，以保留每次故障的关联；普通错误仍沿用原有去重。

档案最多保留最近 5 次，每次最多 20 条 HTTP 尝试。超过 30 天的记录不参与读取/导出，并在下一次记录写入时从磁盘淘汰；这不是后台定时删除任务。记录在退出、切号、重新登录和重启后保留，不依赖 Sentry 初始化或网络。写入失败保留当前进程的内存副本，不阻塞退出。每条记录包含发生时的平台、App/构建版本；导出另带当前版本，便于识别事后升级。

字段仅包括固定原因、时间戳、归一化路由、方法、HTTP 状态、耗时、失败类别、随机请求 ID、凭证是否存在的布尔值，以及必要的响应形状/关闭码。没有 Token、密码、账号/设备/消息 ID、请求头、正文、原始 URL 或异常文本。持久化数据在读取边界重新按白名单构建，未知字段不会被复制或上传。

| `reason` | 能确定的客户端触发点 | 后续核对 |
| --- | --- | --- |
| `refresh-token-missing` | 发起续期时没有 refresh token | 对照此前启动/退出记录；不能仅凭此推断服务端踢人 |
| `refresh-rejected` | 续期被明确拒绝 | 按请求 ID 查实际 401/403、撤销/密码重置审计 |
| `refresh-response-invalid` | 2xx 续期响应为空、凭证对无效、JSON 无效、正文读取失败或错误信封 | `status` 保留真实 HTTP 状态，包括 201；`failureKind` 保留底层失败类别。`responseShape=unknown` 表示没有可检查的凭证对象；两个 `responseHas*Token` 仅在解析到凭证值时记录是否存在非空字符串。新路径 `sessionPreserved=true`，不生成 forcedLogout |
| `refresh-outcome-unknown` | 续期网络/超时/5xx 结果不明，或前置标记、新凭证持久化失败 | `stage=prepare/request/persist` 区分保存发送意图、请求/正文处理和保存后继凭证；`clientRequestId` 是发送前就保存的 UUID，`failureKind` 保留底层类别 |
| `refresh-interrupted` | 冷启动发现上次轮换尚未完成的持久化 UUID | `stage=restore`，按 `clientRequestId` 找原请求；只能确认上次没有完成本地提交，不能仅凭此认定请求到达服务端 |
| `request-rejected-after-refresh` | 续期完成后业务请求仍被拒绝 | 本条 ID 属于重试请求；时间线中另查续期 ID |
| `auth-retry-response-replayed` | 续期后的 401 与原 401 返回相同的有效服务器请求 ID | 保留新凭证；用 `clientRequestId` 查重试是否到达后端，用 `initialRequestId` / `requestId` 查被复用的响应 |
| `realtime-revoked` | 收到固定的会话撤销关闭信号 | `closeCode=1008`，核对服务端撤销事件；不保存原始关闭文本 |
| `bootstrap-rejected` / `bootstrap-tokens-missing` | 启动校验被拒绝 / 缺少凭证 | 对照 `/auth/me` 和启动持久化恢复 |
| `hydration-tokens-invalid` | 持久化恢复出残缺的旧登录态 | 记录清理前的凭证存在布尔值；全新安装的空状态不报 |
| `hydration-read-failed` / `startup-storage-failed` | 安全存储恢复 / 启动存储初始化失败 | 保存本地档案，Sentry 对应 `authStore/hydrationRead` 或 `startup/storageInit`；这两条本身不表示服务端拒绝 |
| `user-logout` / `account-switch` / `password-change` / `email-change` / `account-cancel` / `user-session-revoke` / `failed-login-cleanup` | 明确的用户操作引发清理 | 本地 `userInitiated=true`，不生成 forcedLogout 错误 |
| `account-switch-rejected` | 切换账号时该账号凭证被明确拒绝 | 核对该次请求及服务端状态 |
| `unspecified-clear` | 有旧会话的清理调用遗漏原因 | 仅留本地证据，排查调用点；新增调用必须填写原因 |

### 201 续期响应异常的处理

HTTP 成功不等于客户端已拿到可用凭证。该分支不构造虚假的 401，也不清除本地登录数据；真实的 401/403 拒绝仍按原规则处理。服务端可能已经轮换 refresh token，所以会话和 `refreshAttemptId` 都保留，下次续期带同一 ID 重试（见下一节）。普通操作遇到此失败使用可信的本地化文案提示稍后重试，默认 retry 工具不重试它，等下一次续期时机。

同账号重新登录也建立新的 sessionEpoch，隔离旧请求。已切到另一个会话后才到达的旧回包仍按原 epoch 规则丢弃，不影响新会话。切号时在途的尝试 ID 随账号一起保存，切回来后继续用同一 ID 重试。

每次实际失败的续期请求只生成一条档案和一条 `session/refreshResponseInvalid` 事件，并发调用共用同一请求。档案记录 HTTP 状态、底层失败类别、形状、凭证存在布尔值、耗时和请求 ID，绝不记录错误响应正文。

### 续期结果不明与进程重启

服务端可能已消耗一次性的旧凭证，而客户端遇到超时、网络断开、5xx 或进程被杀，没有收到结果。直接重发旧凭证会被判成重放并吊销整个会话族，所以每次续期带一个尝试 ID，让服务端认出这是同一次尝试。

发送前先将随机 `refreshAttemptId` 与原会话一起持久化，并作为 `Idempotency-Key` 发送；成功收到并保存完整凭证后才清除。结果不明时会话和 ID 都保留，下次续期带同一 ID 重试：服务端发现旧令牌的后继会话带同一 ID 且还没被用来续期，就作废它并重新签发。ID 不符、没带 ID、后继已被使用，仍按重放吊销整个会话族。比后继会话来得还早的重复请求回 409，不动已有会话，客户端按结果不明处理。只有服务端明确的 401/403 才结束会话。

网络/超时/5xx 的不明结果只写本地档案 `refresh-outcome-unknown`，不上报 Sentry。冷启动发现遗留的尝试 ID 时写本地档案 `refresh-interrupted`，并以 `operation=session kind=refreshOutcomeUnknown stage=restore` 上报，绕过 SDK 相同错误去重。这条记录表示上次续期没有确认结果，不等同于新发生了一次服务端失败，下一次续期成功后就不再出现。

强杀可能发生在新凭证已保存但清标记尚未完成的窗口，这时客户端持有新凭证和旧 ID，用它们续期是正常轮换，不影响会话。服务器已返回 201 不证明客户端已收到、解析或持久化成功。2026-11-05 长测确认了另一个会话族重放导致账号级连带撤销，后端范围修复另见 circle_be PR #309；该旧会话更早的响应/写盘记录缺失，不能将本节的可复现机制当作已证实的历史唯一根因。

### 续期后收到重复的旧 401

每次 HTTP 尝试保留发出的 `clientRequestId` 和响应返回的 `requestId`。正常情况下后端回显当前尝试的 ID；没有有效响应头时，`requestId` 仅回落为客户端生成的 ID，不能当作响应重放的证据。仅当原 401 和续期后重试的 401 都带有有效、大小写归一化后相同的服务器 UUID，客户端才记录 `auth-retry-response-replayed`，保留已取得的完整凭证。对业务调用抛出 status 0 的固定响应异常；实际 HTTP 401 保存在档案和 Sentry 上下文中。默认 retry 工具不重试这种错误，避免再次发起续期或重复写操作。新的、不同 ID 的 401，以及响应 ID 缺失/无效时，保留原有拒绝处理。

2026-11-05 的预生产 Android 样本中，`session/forcedLogout` 指向 `/auth/login-challenges` 的 `request-rejected-after-refresh`，实际 APK 字节码确认所记 ID 来自重试响应。源站存在该 ID 的 401，随后同账号另有一次 201 续期且后继会话未撤销。但是旧事件没有初次请求和续期请求的 ID，不能证明这条 201 与退出属于同一次续期链路，也不能证明旧响应实际被复用。已确认的是重试 401 清理分支和未解释的时间顺序。重复响应保护有合成回归用例；历史事故尚未复现，Android/代理缓存及此前所有设备统一退出的共同根因仍未确认。

Sentry 设置 `normalizeDepth=4`，使 `extra.clientDiagnostics[].details` 在 SDK 归一化之后仍为对象，再由 `beforeSend` 白名单过滤。默认深度 3 会先把该字段变成 `[Object]`，造成请求详情丢失。测试按真实 SDK 的归一化、隐私过滤和去重顺序运行，并检查凭证、设备标识和正文不会进入事件。

### 真机后台长测中的实际撤销样本

2026-11-05 后续独立诊断包的本地档案确认了另一条链：同账号其他会话族重放已轮换的 refresh token，后端撤销该族 RT 的同时写入账号级 `accessTokensRevokedAt`，使独立会话尚未到期的 access token 也被拒绝。客户端收到实时通道撤销信号，记录 `realtime-revoked` / `closeCode=1008` 并清理；在途续期随后仍可返回 201，因为独立会话的 RT 没被撤销。该 201 晚于本地清理，不能误归为“成功续期后重试失败”或响应复用。应在后端核对撤销范围；不能通过忽略真实撤销帧解决。此样本不证明早前不同账号统一退出也有相同根因。本次本地档案成功保留了原因，Sentry 暂未查到事件，说明应同时保留离线导出路径。

### 下次复现时怎么收集

1. 记下发生时间和时区，设备系统，以及当时在做什么。多个设备分别收集，不能仅凭同时观察到登录页就认为原因相同。账号 ID 通过授权的排障渠道单独提供，不写进诊断档案；不需要密码、验证码或 Token。
2. 登录页点 **复制登录诊断信息**，将内容交给技术支持。已经重新登录的，进入 **设置** 底部复制。入口仅在有可读档案时显示；可以离线复制，不要求再次登录。先复制，再卸载、清除数据或继续多次切号，避免覆盖有限的历史。
3. 保留整个 JSON，重点取 `records[].id`、`timestamp`、`reason`、发生时的 `buildVersion` 和 `context.requestId`。时间为设备的 Unix 毫秒时间戳，转换为 UTC 后与服务器对照；设备时钟可能有偏差，优先用关联 ID。
4. Sentry 选正确环境和版本，自动退出搜索 `operation:session kind:forcedLogout diagnosticId:<UUID>`；续期响应异常搜索 `operation:session kind:refreshResponseInvalid diagnosticId:<UUID>`；上次续期被中断（冷启动，`stage=restore`）搜索 `operation:session kind:refreshOutcomeUnknown diagnosticId:<UUID>`；重复响应搜索 `operation:session kind:authRetryResponseReplayed diagnosticId:<UUID>`。保留会话的路径确认 `sessionPreserved=true`、实际 status、failureKind 和 stage。存储恢复/写入失败按其 operation/kind 加同一 ID 查询。没有 Sentry 事件时仍先用本地档案继续，不能据此认定没有故障。
5. 在 Loki 选择事故 UTC 时间前后各 5 分钟，查询 `{service="circle-be"} |= "<REQUEST_UUID>"`，再检查 `http_access` / `http_error` 的 method、path、statusCode、aborted、durationMs。先用精确 UUID 文本匹配可兼容根层和嵌套 message JSON；展开后按实际字段过滤。401 原请求、refresh、retry 各自生成不同的 `clientRequestId`，逐个串起来；若重试返回的 `requestId` 与原 401 相同，分别查发送 ID 和响应 ID，不能把原请求日志误认作一次新凭证拒绝。
6. 对照同一时间窗的 `security_event`、会话撤销/密码重置审计、发布和进程启动日志。通过受限的只读数据库查询核对会话是否撤销、续期和密码登录的先后；不要导出凭证或整行会话。请求成功但随后本地清理，继续按本地 `reason` 定位分支；服务端明确撤销则追到对应审计操作。需要第二台设备时重复完整采集，再判断是否有共同触发点。

### 保留窗口和证据边界

- 当前服务器 Loki 可检索 7 天，删除延迟 2 小时。后端文件按小时或 20 MB 轮转，配置保留 14 天，蓝绿各有持久卷；Alloy 读取两边，容器替换不等于历史日志消失。优先查 Loki，超过其窗口再由授权运维检查应用卷；不要只查当前容器的 `docker logs`。这是单机留存，主机丢失并无异地备份保证。
- 若无法通过 App 导出，可在复现前连接 USB 调试，使用 `adb logcat --pid=<当前App进程ID> -v threadtime` 保存该进程的原生错误，进程重启后重新获取 PID；崩溃另查 `adb logcat -b crash -d -v threadtime`。原生日志可能含系统/第三方信息，只放受限排障目录，不提交仓库或公开粘贴。正式包不能依赖 `run-as` 读取私有目录。
- 不能承诺任何情况下都能还原根因：强杀恰好发生在异步写盘前、存储本身不可用、卸载/清数据、长期未反馈或缺少该版本日志，都可能留下证据缺口。若复制入口没有出现，应记录这一事实和版本，及时采集原生日志及服务端记录，不反复重装覆盖现场。

2026-11-04 的“统一掉线”尚未建立共同根因：一个已核对样本对应密码重置撤销，另一个样本服务端续期成功后的客户端清理仍无历史证据。已发布客户端 8d9be731 的并发过期和延迟 401 重放均正常；这不能替代 React Native 设备端证据。新增记录旨在下次明确区分这些分支。

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
| 客户端请求过程 | 最近 20 条内存面包屑 + 退出时独立本地档案 | 每次 HTTP 尝试记录安全路由、method/status、耗时、requestId、结果；退出档案可在登录页/设置复制 |
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

每次请求完成都会保留内存诊断；慢请求阈值为 2 秒。相同安全路由/method/status/apiCode/failureKind 的 Sentry API 事件最多每分钟一次，最多 100 个记账键（含溢出桶）。这是防止离线重试耗尽配额，**不是准确失败次数统计**。退出账号清空内存缓冲与限流记账，独立退出档案继续保留；旧会话迟到的请求不会污染新会话诊断。

## 隐私和噪声

- HTTP 开发日志也不再输出请求/响应正文、自定义请求头、查询键值或原始异常文本。旧 `logResponseBody` 参数保留类型兼容，但不能打开正文日志。
- HTTP 路由按 `src/observability/http-diagnostics.ts` 中审核过的模板归一化；未知路径直接 `/__other__`，纯字母 ID 和 QR bearer token 也不会原样保留。新增接口时维护模板；漏配只降低分组精度，不放开原始路径。
- 按本轮明确授权，仅发送内部 `user.id` 用于按用户排障；邮箱、昵称、手机号、IP 等身份字段仍过滤。用户 ID 与 requestId 都是可关联的运维数据，Sentry/Loki需要访问控制、合理保留期和团队授权。
- 截图、view hierarchy、失败请求自动抓取关闭，Replay采样率为0。正常本地诊断不构成单独的上传事件。
- JavaScript `beforeSend`/breadcrumb/span sanitizer 只保证经过 JS SDK 的事件。**React Native原生SDK独立生成的崩溃事件不经过这些JS钩子**；仍保留原生崩溃上报。原生异常消息的彻底过滤需单独验收原生钩子或 Sentry 服务端清洗，不能把 `sendDefaultPii:false` 当成所有字段都已脱敏的证明。
- `preprod` 构建变体使用独立的 `preproduction` 环境；生产默认采样 5% 性能 trace。只保留白名单数值性能测量和合法 trace/span ID，不上传任意 span 描述或上下文。

## 每次上线前需要核对的验收

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
