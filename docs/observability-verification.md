# 2026-09-22 监控补齐验证记录

本轮仅本地实现与离线验证。前端在原有 `codex/tabbar-unread-count-20260915` 分支；后端保留在 `.codex-worktrees/circle-be-observability`（`codex/circle-be-observability`）。未提交、推送或部署，原有无关改动保留。

## 最终验证

| 范围 | 命令/方式 | 结果 |
| --- | --- | --- |
| 前端类型与规范 | `npm run typecheck`、`npm run lint` | 通过 |
| 前端可观测性 | 六个 API / diagnostics / Sentry Node 测试文件 | 101 通过 |
| 前端行为 | `npm run test:behavior -- --runInBand --silent` | 52 suites，283 通过 |
| 前端全量 CI | `npm run ci`，设置 `CIRCLE_BE_PATH` 指向上述后端工作区 | 通过：类型检查、Expo 配置、lint、全量 Node 测试和行为测试均为绿色 |
| 前端平台复核 | Windows 的 Android 预生产 workflow/identity 与 keyboard 测试 | 通过；测试显式使用 Git for Windows Bash，并使用平台正确的路径分隔符 |
| 后端编译 | `npm run build` | 通过，生成客户端复制完成 |
| 后端规范 | `npx eslint "{src,apps,libs,test}/**/*.ts" --quiet`，不使用带 `--fix` 的项目 lint 脚本 | 0 errors；不代表所有既有 warnings 消失 |
| 后端便携单测 | `npm test -- --runInBand --silent --testPathIgnorePatterns='redis-deploy.spec.ts\|monitoring-blackbox-exporter.spec.ts'` | 291 suites、3677 通过、7 既有跳过；另排除上述两个 Bash/Linux 文件 |
| 监控配置契约 | `node --test test/prometheus-alerts.spec.mjs test/monitoring-operations-dashboard.spec.mjs` | 29/29 通过 |
| 原生规则行为 | `prom/prometheus:v3.7.3` 的 `promtool check rules` 与 `test rules` | 40 条规则合法，行为场景通过 |
| Prometheus 配置 | 同一 pinned promtool 检查 dev/prod | 通过；未挂载可选 logs/probe targets 时有预期警告；生产 token 使用无秘密测试文件，仅校验配置 |
| Grafana / Compose | 11 条 Operations PromQL 的原生校验；base、prod、logs overlay `docker compose config --quiet` | 独立实现阶段验证通过；没有启动监控栈 |

六个前端聚焦文件：`api-client-logging`、`api-client-body-read`、`api-client-refresh-session`、`diagnostics-sentry-breadcrumbs`、`sentry-observability`、`sentry-report-context`（均位于 `test/`）。

## 前端最终测试与运行时边界

- Windows 测试现在明确选择 Git for Windows Bash，以受控的进程内命令替身执行 release fixture；路径断言使用平台正确的分隔符。原有 rollback、publisher、manifest 与 keyboard 覆盖均保留，`npm run ci` 最终通过。
- `CHAT_DELIVERY_ID_CONFLICT` 已加入前端错误码镜像与英/中/日/韩/西五语文案。跨仓库契约和完整本地化测试均通过（`api-error-localization.test.js` 19/19）。
- Expo 类型检查提示 Sentry organization/project 缺配置；真实 source-map 上传凭据、发布关联与符号化需构建环境验收。

## 关键回归证据

- Expo 实际 production Babel transform：静态 DSN 替换后，在空运行时环境仍能正确初始化；没有依赖测试中伪造的动态 env 读取。
- API → 本地面包屑 → Sentry 最终清洗的联测：成功请求不单独上传；失败保留相同 requestId，聊天内容/动态 ID/正文不进入事件。
- 初次请求、refresh、retry 分别使用独立 ID；断流、超时、refresh 非法 token pair 和 retry 失败均保留正确关联。旧会话迟到请求不写入新会话诊断；遥测端抛错不替换原业务错误。
- 真实安装的 Sentry Node SDK，通过内存 transport 在子进程中验证：rejection 单次事件且继续运行；fatal 单次事件且退出 1；最终序列化事件的 process mechanism 为 `handled:false`，stderr 不含原始私密错误文本。
- 挂起的 flush 且没有其他活动句柄时，真实子进程仍等待硬截止时间并退出 1；定时器不能 `unref()`。普通 flush 完成后会清理截止定时器。
- 编译 JS + 外部 source map 的自动化测试确认错误栈映射到 TypeScript。
- Promtool 场景覆盖相同 scrape job 下不同 cron 相互隔离、蓝绿心跳恢复、不同池容量、监控自告警触发与恢复、未启用日志组件不误报。

## 未进行的线上验收

真实 Sentry/通知接收、原生崩溃内容清洗、source-map artifact 上传、Grafana 实际加载、Loki 生产日志采集、公网探测目标、外部 Watchdog 接收、预生产业务 E2E 均未声称完成。操作清单见 [监控与排障指南](./observability.md)。
