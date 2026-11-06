# Circle 全链路监控与排障

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

HTTP 成功不等于客户端已拿到可用凭证。该分支不再构造虚假的 401 或清除本地登录数据；真实的 401/403 拒绝仍按原规则处理。服务端可能已经轮换 refresh token，所以不能自动重发旧凭证：认证存储记录 `refreshUncertain=true`，暂停这个会话的后续自动续期；已写入的标记跨重启、切换账号保留。仍有效的 access token 可以继续使用；需要重新登录取得完整的新凭证才能恢复续期。新登录、成功设置新凭证、明确退出会重置此标记；普通操作遇到此失败使用可信的本地化文案提示重新登录，默认 retry 工具也不再重试它。

同账号重新登录也建立新的 sessionEpoch，隔离旧请求。已切到另一个会话后才到达的旧回包仍按原 epoch 规则丢弃，不标记或清理新会话。切号时已经在途的轮换会折算为暂停标记；尚未设置轮换标记时就已被其他流程捕获的旧凭证快照，仍不能由这个标记追溯保护。

每次实际失败的续期请求只生成一条档案和一条 `session/refreshResponseInvalid` 事件，并发调用共用同一请求。之后被标记拦截的尝试不重复上报；重新登录后再次发生会产生新的诊断 ID。档案记录 HTTP 状态、底层失败类别、形状、凭证存在布尔值、耗时和请求 ID，绝不记录错误响应正文。安全存储写入失败另外上报 `session/refreshStatePersist`，携带同一诊断 ID；此时当前进程仍停止续期，但不能保证跨重启的拦截标记已落盘。

### 续期结果不明与进程重启

续期不是可安全重试的普通 GET：服务端可能已消耗一次性的旧凭证，而客户端遇到超时、网络断开或 5xx。旧实现会保留旧凭证并在下次请求时再次发送；回归用例已证明，这会把“服务端已轮换、客户端丢失响应”转成会话族重放。此用例证明代码缺陷，不代表已经还原某次历史手机事故的底层异常。

现在发送前先将随机 `refreshAttemptId` 与原会话一起持久化，成功收到完整凭证后，等待新凭证和清除标记的实际存储写入完成，再释放续期单例。正常在途请求不置 `refreshUncertain`，不弹恢复提示；错误或冷启动遗留 UUID 才进入暂停状态。网络/超时/5xx 的不明结果以 `operation=session kind=refreshOutcomeUnknown` 上报，本地保存上述两个新原因，并绕过 SDK 相同错误去重。冷启动记录表示恢复到未完成状态，不等同于新发生了一次服务端失败。

这个选择保留登录数据、仍有效的 access token 和聊天缓存，但在无法确认轮换结果时需要重新登录，不再自动重发旧凭证。后台聊天/实时通道主动续期也会触发全局提示，提供现有的登录入口；取消提示可继续浏览本地内容。登录成功前不会主动清会话。发送前标记写入失败时不发送；保存后继凭证失败时保留内存里的新凭证并暂停，不回滚到旧凭证。切号保存/取消登录回滚时，在途 UUID 也折算成暂停标记，避免将它保存成可重放的旧凭证。

应用锁已开启或资料引导尚未完成时，明确的恢复操作也仅放行认证页面。应用锁对缓存页面和陌生设备批准操作仍有效；返回原页面即恢复锁屏。资料引导也不会因恢复操作而被视为完成。

强杀可能发生在新凭证已保存但清标记尚未完成的窗口，这时也会要求重新登录；该策略优先避免重放，未新增服务端幂等恢复或放宽重放检测。服务器已返回 201 不证明客户端已收到、解析或持久化成功。2026-11-05 长测确认了另一个会话族重放导致账号级连带撤销，后端范围修复另见 circle_be PR #309；该旧会话更早的响应/写盘记录缺失，不能将本节的可复现机制当作已证实的历史唯一根因。

### 续期后收到重复的旧 401

每次 HTTP 尝试保留发出的 `clientRequestId` 和响应返回的 `requestId`。正常情况下后端回显当前尝试的 ID；没有有效响应头时，`requestId` 仅回落为客户端生成的 ID，不能当作响应重放的证据。仅当原 401 和续期后重试的 401 都带有有效、大小写归一化后相同的服务器 UUID，客户端才记录 `auth-retry-response-replayed`，保留已取得的完整凭证，不设置 `refreshUncertain`。对业务调用抛出 status 0 的固定响应异常；实际 HTTP 401 保存在档案和 Sentry 上下文中。默认 retry 工具不重试这种错误，避免再次发起续期或重复写操作。新的、不同 ID 的 401，以及响应 ID 缺失/无效时，保留原有拒绝处理。

2026-11-05 的预生产 Android 样本中，`session/forcedLogout` 指向 `/auth/login-challenges` 的 `request-rejected-after-refresh`，实际 APK 字节码确认所记 ID 来自重试响应。源站存在该 ID 的 401，随后同账号另有一次 201 续期且后继会话未撤销。但是旧事件没有初次请求和续期请求的 ID，不能证明这条 201 与退出属于同一次续期链路，也不能证明旧响应实际被复用。已确认的是重试 401 清理分支和未解释的时间顺序。重复响应保护有合成回归用例；历史事故尚未复现，Android/代理缓存及此前所有设备统一退出的共同根因仍未确认。

Sentry 设置 `normalizeDepth=4`，使 `extra.clientDiagnostics[].details` 在 SDK 归一化之后仍为对象，再由 `beforeSend` 白名单过滤。默认深度 3 会先把该字段变成 `[Object]`，造成请求详情丢失。测试按真实 SDK 的归一化、隐私过滤和去重顺序运行，并检查凭证、设备标识和正文不会进入事件。

### 真机后台长测中的实际撤销样本

2026-11-05 后续独立诊断包的本地档案确认了另一条链：同账号其他会话族重放已轮换的 refresh token，后端撤销该族 RT 的同时写入账号级 `accessTokensRevokedAt`，使独立会话尚未到期的 access token 也被拒绝。客户端收到实时通道撤销信号，记录 `realtime-revoked` / `closeCode=1008` 并清理；在途续期随后仍可返回 201，因为独立会话的 RT 没被撤销。该 201 晚于本地清理，不能误归为“成功续期后重试失败”或响应复用。应在后端核对撤销范围；不能通过忽略真实撤销帧解决。此样本不证明早前不同账号统一退出也有相同根因。本次本地档案成功保留了原因，Sentry 暂未查到事件，说明应同时保留离线导出路径。

### 下次复现时怎么收集

1. 记下发生时间和时区，设备系统，以及当时在做什么。多个设备分别收集，不能仅凭同时观察到登录页就认为原因相同。账号 ID 通过授权的排障渠道单独提供，不写进诊断档案；不需要密码、验证码或 Token。
2. 登录页点 **复制登录诊断信息**，将内容交给技术支持。已经重新登录的，进入 **设置** 底部复制。入口仅在有可读档案时显示；可以离线复制，不要求再次登录。先复制，再卸载、清除数据或继续多次切号，避免覆盖有限的历史。
3. 保留整个 JSON，重点取 `records[].id`、`timestamp`、`reason`、发生时的 `buildVersion` 和 `context.requestId`。时间为设备的 Unix 毫秒时间戳，转换为 UTC 后与服务器对照；设备时钟可能有偏差，优先用关联 ID。
4. Sentry 选正确环境和版本，自动退出搜索 `operation:session kind:forcedLogout diagnosticId:<UUID>`；续期响应异常搜索 `operation:session kind:refreshResponseInvalid diagnosticId:<UUID>`；轮换结果不明/中断搜索 `operation:session kind:refreshOutcomeUnknown diagnosticId:<UUID>`；重复响应搜索 `operation:session kind:authRetryResponseReplayed diagnosticId:<UUID>`。保留会话的路径确认 `sessionPreserved=true`、实际 status、failureKind 和 stage。存储恢复/写入失败按其 operation/kind 加同一 ID 查询。没有 Sentry 事件时仍先用本地档案继续，不能据此认定没有故障。
5. 在 Loki 选择事故 UTC 时间前后各 5 分钟，查询 `{service="circle-be"} |= "<REQUEST_UUID>"`，再检查 `http_access` / `http_error` 的 method、path、statusCode、aborted、durationMs。先用精确 UUID 文本匹配可兼容根层和嵌套 message JSON；展开后按实际字段过滤。401 原请求、refresh、retry 各自生成不同的 `clientRequestId`，逐个串起来；若重试返回的 `requestId` 与原 401 相同，分别查发送 ID 和响应 ID，不能把原请求日志误认作一次新凭证拒绝。
6. 对照同一时间窗的 `security_event`、会话撤销/密码重置审计、发布和进程启动日志。通过受限的只读数据库查询核对会话是否撤销、续期和密码登录的先后；不要导出凭证或整行会话。请求成功但随后本地清理，继续按本地 `reason` 定位分支；服务端明确撤销则追到对应审计操作。需要第二台设备时重复完整采集，再判断是否有共同触发点。

### 保留窗口和证据边界

- 当前服务器 Loki 可检索 7 天，删除延迟 2 小时。后端文件按小时或 20 MB 轮转，配置保留 14 天，蓝绿各有持久卷；Alloy 读取两边，容器替换不等于历史日志消失。优先查 Loki，超过其窗口再由授权运维检查应用卷；不要只查当前容器的 `docker logs`。这是单机留存，主机丢失并无异地备份保证。
- 若无法通过 App 导出，可在复现前连接 USB 调试，使用 `adb logcat --pid=<当前App进程ID> -v threadtime` 保存该进程的原生错误，进程重启后重新获取 PID；崩溃另查 `adb logcat -b crash -d -v threadtime`。原生日志可能含系统/第三方信息，只放受限排障目录，不提交仓库或公开粘贴。正式包不能依赖 `run-as` 读取私有目录。
- 不能承诺任何情况下都能还原根因：强杀恰好发生在异步写盘前、存储本身不可用、卸载/清数据、长期未反馈或缺少该版本日志，都可能留下证据缺口。若复制入口没有出现，应记录这一事实和版本，及时采集原生日志及服务端记录，不反复重装覆盖现场。

2026-11-04 的“统一掉线”尚未建立共同根因：一个已核对样本对应密码重置撤销，另一个样本服务端续期成功后的客户端清理仍无历史证据。已发布客户端 8d9be731 的并发过期和延迟 401 重放均正常；这不能替代 React Native 设备端证据。新增记录旨在下次明确区分这些分支。

## 各层各自回答什么问题

| 层 | 工具/信号 | 用途与边界 |
| --- | --- | --- |
| 客户端错误 | Sentry JS、路由 ErrorBoundary、已处理失败上报、原生崩溃 | 定位错误类型/代码位置；常见业务拒绝不报，原生边界见下文 |
| 客户端请求过程 | 最近 20 条内存面包屑 + 退出时独立本地档案 | 每次 HTTP 尝试记录安全路由、method/status、耗时、requestId、结果；退出档案可在登录页/设置复制 |
| 服务端错误 | Sentry + Nest 全局异常处理 + 进程/启动兜底 | HTTP 5xx、任务/依赖异常、启动失败、未处理异常；保留脱敏机制标记及跟踪 ID |
| 服务端运行日志 | Winston JSON + 可选 Loki/Alloy | 根据 requestId 或 job/runId 检索请求、慢操作和后台任务；不是无限期审计档案 |
| 接口与业务指标 | Prometheus + Grafana `circle_be — RED` | 流量、错误率、延迟、在线连接、业务事件；不把账号/requestId放进指标标签 |
| 后台任务与队列 | Grafana `circle_be — Jobs, Queues & Datastores` | 各任务心跳/失败、outbox积压和死信；查询使用抓取后的 exported_job 区分任务 |
| 主机、依赖、公网 | node-exporter、cAdvisor、Postgres/Redis exporter、blackbox | 资源余量、依赖可用性、DNS/TLS/入口可达性；部分只存在于生产 overlay |
| 监控系统自身 | Grafana `circle_be — Operations Overview` + Alertmanager + 外部 Watchdog | 抓取健康、规则执行、投递失败、日志重试/丢弃、监控栈整体失联 |

后端实施说明在后端仓库 `docs/observability.md`、`monitoring/README.md` 与 `monitoring/logs.md`。三个 Grafana 面板由现有 provisioning 自动加载，需按既有部署流程更新配置。

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
- 默认不发送账号身份；保留的 requestId 仍是可关联的运维数据，Sentry/Loki需要访问控制、合理保留期和团队授权。
- 截图、view hierarchy、失败请求自动抓取关闭，Replay采样率为0。正常本地诊断不构成单独的上传事件。
- JavaScript `beforeSend`/breadcrumb/span sanitizer 只保证经过 JS SDK 的事件。**React Native原生SDK独立生成的崩溃事件不经过这些JS钩子**；仍保留原生崩溃上报。原生异常消息的彻底过滤需单独验收原生钩子或 Sentry 服务端清洗，不能把 `sendDefaultPii:false` 当成所有字段都已脱敏的证明。
- `preprod` 构建变体使用独立的 `preproduction` 环境；生产默认采样 5% 性能 trace。只保留白名单数值性能测量和合法 trace/span ID，不上传任意 span 描述或上下文。

## 每次上线前需要核对的验收

- 在批准的构建环境填写 DSN/release/dist、私有 source-map 上传凭据；私有 token 绝不使用 `EXPO_PUBLIC_`。缺少 DSN 时客户端不初始化 Sentry。
- 重建预生产 App，分别验证 JS渲染异常、已处理失败和**原生崩溃**的真实到达、归组、源码位置和隐私清洗。测试后关闭测试开关，不在真实用户会话故意触发崩溃。
- 后端配置 `LOG_AGGREGATION_PROVIDER=sentry`、`SENTRY_DSN` 和 release；本地 `.js.map` 随镜像保留。Node本地映射不等于已上传 Sentry artifacts，完整源码上下文仍要验收发布流程。
- Prometheus Targets 中检查应用/依赖、Alertmanager，及启用日志 overlay 后的 Loki/Alloy；**未启用的可选组件显示 No data，不等于健康**。
- 从批准的测试环境触发一条可恢复告警，确认真实接收人收到并能看到恢复通知；再验证外部 Watchdog 的失联通知。通过已经损坏的接收器发送“接收器坏了”的告警并不能保证送达。
- 真正的 API/登录/上传/聊天/通知/通话 E2E 需要预生产依赖与测试账号；离线单测不能替代它。

## 参考依据

- [Expo 环境变量必须静态读取](https://docs.expo.dev/guides/environment-variables/)
- [Sentry React Native 7.11 原生桥接边界](https://github.com/getsentry/sentry-react-native/blob/7.11.0/packages/core/src/js/wrapper.ts)
- [Prometheus 抓取标签冲突规则](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config)
- [Alloy 日志发送重试/丢弃指标](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.write/#debug-metrics)
