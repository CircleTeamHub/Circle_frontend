# Circle 全链路监控与排障

本轮补齐的是代码、配置和离线验证，**没有启用线上采集、发送测试告警或部署应用**。前端仍使用现有 Sentry，不新增独立日志上传服务；后端沿用现有 Prometheus/Grafana/Alertmanager，Loki/Alloy 为可选组件。

## 各层各自回答什么问题

| 层 | 工具/信号 | 用途与边界 |
| --- | --- | --- |
| 客户端错误 | Sentry JS、路由 ErrorBoundary、已处理失败上报、原生崩溃 | 定位错误类型/代码位置；常见业务拒绝不报，原生边界见下文 |
| 客户端请求过程 | 最近 20 条本地诊断面包屑 | 每次 HTTP 尝试记录安全路由、method/status、耗时、requestId、结果；单独记日志不上传 |
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

每次请求完成都会保留本地诊断；慢请求阈值为 2 秒。相同安全路由/method/status/apiCode/failureKind 的 Sentry API 事件最多每分钟一次，最多 100 个记账键（含溢出桶）。这是防止离线重试耗尽配额，**不是准确失败次数统计**。退出账号清空缓冲与限流记账；旧会话迟到的请求不会污染新会话诊断。

## 隐私和噪声

- HTTP 开发日志也不再输出请求/响应正文、自定义请求头、查询键值或原始异常文本。旧 `logResponseBody` 参数保留类型兼容，但不能打开正文日志。
- HTTP 路由按 `src/observability/http-diagnostics.ts` 中审核过的模板归一化；未知路径直接 `/__other__`，纯字母 ID 和 QR bearer token 也不会原样保留。新增接口时维护模板；漏配只降低分组精度，不放开原始路径。
- 默认不发送账号身份；保留的 requestId 仍是可关联的运维数据，Sentry/Loki需要访问控制、合理保留期和团队授权。
- 截图、view hierarchy、失败请求自动抓取关闭，Replay采样率为0。正常本地诊断不构成单独的上传事件。
- JavaScript `beforeSend`/breadcrumb/span sanitizer 只保证经过 JS SDK 的事件。**React Native原生SDK独立生成的崩溃事件不经过这些JS钩子**；仍保留原生崩溃上报。原生异常消息的彻底过滤需单独验收原生钩子或 Sentry 服务端清洗，不能把 `sendDefaultPii:false` 当成所有字段都已脱敏的证明。
- `preprod` 构建变体使用独立的 `preproduction` 环境；生产默认采样 5% 性能 trace。只保留白名单数值性能测量和合法 trace/span ID，不上传任意 span 描述或上下文。

## 上线前验收（本轮未执行）

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
