# WindNote E2E、负载与客户端性能测试设计

**日期：** 2026-08-18

**目标仓库：** `Circle_frontend`

**目标分支：** `main`

**实现分支：** `codex/windnote-e2e-performance`

**状态：** 已获用户批准，等待书面设计复核

## 1. 目标

为 WindNote 建立一套可在 Android 与 iOS 共用的真实应用 UI E2E 测试，并补充聊天系统的后端负载测试和客户端性能采集能力。首轮交付写全双平台测试代码、运行器、安全门禁、测试数据契约和文档；本轮不要求在当前 Windows 机器完成 iOS 真机执行，也不把设备测试设为合并阻断项。

这套测试回答三个不同问题：

1. 用户能否通过真实 UI 完成关键业务闭环；
2. 大量用户并发发送消息、加入圈子或汇聚到同一接收者时，服务端是否保持可用；
3. 单台设备面对大量会话和消息时，消息页与聊天页是否出现明显卡顿、内存增长或交互延迟。

## 2. 已有基础与明确缺口

WindNote 已有 `node --test`、Jest/React Native Testing Library、TypeScript、ESLint、Expo 配置检查、Web export、依赖审计和安全扫描。聊天 store、协议、重连、乐观消息、历史分页、未读数与多个业务屏幕已有较丰富的行为测试。

仍缺少：

- 真实 Android/iOS 应用的 UI E2E；
- 稳定、语言无关的 E2E 定位器；
- 真实后端上的登录、导航与业务持久化闭环；
- 聊天 REST/Socket.IO 并发负载测试；
- 大量会话、大量消息和事件风暴下的客户端性能场景；
- FPS、卡顿帧、内存和用户操作耗时的可重复采集；
- E2E/负载执行的非生产环境保护和测试数据隔离规则。

## 3. 技术选择

### 3.1 UI E2E：Maestro

选择 Maestro，原因如下：

- 官方支持 React Native、Expo、Android 与 iOS；
- 同一套 YAML flow 可运行于两个平台；
- 直接测试最终应用，无需把测试框架链接进生产包；
- React Native `testID` 会映射为 Maestro 可查询的原生标识；
- 相比 Detox，减少 Expo 原生构建和灰盒同步配置；
- 相比 Appium，运行与维护成本更低。

E2E 使用 standalone/development build 的应用 ID `com.yiboding.circleim`。流程不依赖可翻译文本完成关键定位；文本只用于验证用户可见结果。

### 3.2 服务端负载：k6

使用 k6 测量 REST 与聊天 Socket.IO 协议。Socket 场景按当前前端协议连接：

- Socket.IO path：`/chat-ws`；
- transport：WebSocket；
- auth：Bearer access token 对应的 Socket.IO `auth.token`；
- 发送事件：`chat:send`；
- 接收事件：`chat:msg`；
- 载荷字段：`conversationId`、`type`、`content`、`d`；
- 以唯一 delivery ID `d` 验证 ack、去重与端到端延迟。

脚本只接受预先准备的短期 access token 和测试资源 ID，不实现绕过正常身份认证的测试后门。

### 3.3 客户端性能：平台原生采集

共享 Maestro flow 负责重复执行消息列表滚动、打开会话、聊天页滚动和切换会话；平台脚本负责采集：

- Android：`adb shell dumpsys gfxinfo` 的帧统计、进程内存，以及可选 Perfetto trace；
- iOS：`xcrun xctrace` 的 Time Profiler/Core Animation trace 和进程内存；
- Maestro：场景总耗时、失败步骤、截图和 flow 结果。

不在生产代码中加入性能测试专用业务分支，也不使用开发模式 FPS 作为发布性能结论。性能测试运行 release/profile 等价构建。

## 4. 目录与职责

```text
.maestro/
|-- config.yaml
|-- flows/
|   |-- smoke.yaml
|   |-- auth-navigation.yaml
|   |-- chat-message.yaml
|   |-- moment-lifecycle.yaml
|   |-- profile-settings.yaml
|   `-- social-circle.yaml
|-- performance/
|   |-- conversation-list-scroll.yaml
|   |-- chat-history-scroll.yaml
|   `-- conversation-switch-storm.yaml
`-- subflows/
    |-- launch.yaml
    |-- ensure-signed-in.yaml
    |-- sign-in.yaml
    |-- open-seeded-conversation.yaml
    `-- sign-out.yaml

e2e/
|-- README.md
|-- env.example
|-- locator-contract.json
`-- fixtures.md

load-tests/
|-- README.md
|-- lib/
|   |-- config.js
|   |-- data.js
|   |-- socket-io.js
|   `-- thresholds.js
|-- scenarios/
|   |-- chat-send.js
|   |-- chat-fan-in.js
|   |-- circle-join.js
|   `-- inbox-seed.js
`-- data/
    `-- accounts.example.json

scripts/
|-- run-e2e.mjs
|-- run-load.mjs
|-- prepare-performance-fixture.mjs
|-- perf-android.ps1
`-- perf-ios.sh
```

`run-e2e.mjs` 是跨平台入口，负责校验 suite、应用 ID、API origin、账号和写操作许可，然后调用 Maestro。`run-load.mjs` 负责校验场景、token 数据、origin、并发参数和生产禁用规则，然后调用 k6。平台性能脚本只负责设备发现、采集开始/结束和产物整理。

## 5. UI 定位器设计

定位器统一使用 `windnote.<surface>.<control>` 命名，例如：

- `windnote.auth.login.screen`
- `windnote.auth.login.account-input`
- `windnote.auth.login.submit`
- `windnote.tabs.messages`
- `windnote.messages.screen`
- `windnote.messages.conversation-list`
- `windnote.chat.screen`
- `windnote.chat.composer.input`
- `windnote.chat.composer.send`
- `windnote.discover.screen`
- `windnote.profile.screen`

规则：

- 仅给 E2E 需要触达或断言的稳定产品表面补 `testID`；
- 自定义组件必须把 `testID` 透传到实际原生 View/Pressable/TextInput；
- 动态行使用稳定业务 ID，例如 `windnote.messages.conversation.<conversationId>`；
- 测试不依赖列表序号或“第一个圈子/第一个好友”；
- locator contract 由快速 Node 测试检查，防止重构时静默删掉关键标识；
- `testID` 不改变运行时业务行为、网络请求或可访问性文案。

## 6. E2E 业务覆盖

### 6.1 `smoke`

只读、无账号要求：

1. 启动真实应用；
2. 在有界时间内到达登录页、onboarding 或已登录 shell；
3. 证明启动未崩溃、未永久停在 splash/loading；
4. 保存失败截图和层级信息。

### 6.2 `auth-navigation`

使用专用 E2E 账号：

1. 通过真实账号与验证码/密码 UI 登录；
2. 打开受保护页面证明登录状态；
3. 重启应用并验证 session 恢复；
4. 依次打开消息、联系人、发现和个人主页；
5. 从设置执行退出并验证回到登录页。

账号输入模式由环境变量明确指定为 `password` 或 `verification-code`，不得在失败时自动改用另一种方式。

### 6.3 `chat-message`

使用精确的 `E2E_CONVERSATION_ID` 与可见名称：

1. 打开指定会话；
2. 发送 `WINDNOTE-E2E-CHAT-<runId>`；
3. 验证消息只出现一次；
4. 返回消息列表再重新进入；
5. 验证历史中仍存在同一消息；
6. 若产品没有发送者可见的彻底删除操作，消息保留在专用测试会话中。

### 6.4 `moment-lifecycle`

1. 发布唯一文字动态；
2. 在自己的动态入口找到它；
3. 打开详情验证内容；
4. 通过 UI 删除；
5. 验证列表和详情入口均不再显示；
6. 清理失败必须使 suite 失败并输出 run ID。

### 6.5 `profile-settings`

1. 修改昵称为带 run ID 的临时值并验证个人主页；
2. 在 `finally` 等价清理 flow 中恢复原昵称；
3. 切换一个通知选项并恢复；
4. 切换一个隐私选项并恢复；
5. 任一恢复失败都视为测试失败。

原昵称由环境变量显式提供，测试不猜测或抓取不稳定文本作为回滚依据。

### 6.6 `social-circle`

首轮保持只读：

1. 通过精确账号/昵称搜索已接受好友；
2. 打开好友资料并返回；
3. 通过精确 `E2E_CIRCLE_ID` 打开已加入圈子；
4. 打开该圈子的群聊入口并返回消息列表。

真实加入/退出留给隔离的负载账号，避免共享 E2E 账号破坏圈子成员状态。

## 7. 环境与数据安全边界

所有真实后端测试遵守以下规则：

- `E2E_EXECUTE=true` 才允许启动；
- 任何写流程还要求 `E2E_ALLOW_MUTATION=true`；
- `LOAD_EXECUTE=true` 才允许负载测试；
- `LOAD_ALLOW_MUTATION=true` 才允许发消息或加入圈子；
- API 与 Socket origin 必须相同或位于显式 allowlist；
- host 包含生产域名或未配置时，在启动应用/k6 前失败；
- 凭证、token 和账号清单不入库；
- 每个写入带唯一 run ID；
- 同一测试账号上的变更 suite 串行执行；
- 并发测试使用一次性或专用账号池；
- 日志不输出 access token、验证码、消息正文、真实用户 ID 或完整请求体。

提交的 `env.example` 和 `accounts.example.json` 只包含假值和字段说明。

## 8. 负载场景

### 8.1 `chat-send`

每个虚拟用户连接自己的 Socket.IO 会话，并向分配的测试会话发送唯一消息。测量：

- 连接成功率；
- `chat:send` ack 成功率与延迟；
- `chat:msg` 回声到达率与端到端延迟；
- 重复 delivery ID 是否只产生一条权威消息；
- Socket 意外断开率。

### 8.2 `chat-fan-in`

大量发送账号从多个不同会话向一个专用接收账号汇聚消息。接收账号持续在线，记录：

- 每秒接收事件数；
- 发送 ack 到接收 `chat:msg` 的延迟；
- 丢失、重复、乱序和重连次数；
- REST 会话列表最终未读数与已发送数量是否收敛。

该场景对应“同时很多聊天找同一个用户”。

### 8.3 `circle-join`

专用账号池在控制速率下调用 `POST /circle/:id/join`，目标圈子按账号清单分配。测量：

- 成功、需要审核、业务拒绝与服务错误的分类；
- p50/p95/p99 延迟；
- 429 与 5xx 比例；
- 加入后 `GET /circle/my?tab=joined` 与聊天会话可见性的最终一致时间。

清理阶段对成功加入且允许退出的夹具调用 `DELETE /circle/:id/leave`。清理失败单独报告，不能掩盖主场景结果。

### 8.4 `inbox-seed`

这是客户端性能夹具准备场景，不作为容量结论。它使用专用账号池和预建圈子/会话，为目标账号形成可配置的 100、500、1000 个会话，每个会话形成 20、100、200 条历史消息。准备脚本输出不含 token 的 manifest：会话数量、消息数量、run ID 和测试账号别名。

## 9. 客户端性能场景

性能测试只运行在 `inbox-seed` 生成的专用账号上。

### 9.1 会话列表滚动

- 冷启动后进入消息页；
- 等待 1000 会话列表稳定；
- 连续快速向下/向上滚动固定次数；
- 打开靠近列表末端的指定会话；
- 记录帧、卡顿帧、内存峰值与操作耗时。

### 9.2 长聊天历史滚动

- 打开含 200 条本地窗口消息且服务端有更长历史的指定会话；
- 重复加载旧消息并双向滚动；
- 验证输入框仍可聚焦、输入与发送；
- 记录帧、内存和加载旧页耗时。

### 9.3 会话切换事件风暴

- 在多个有持续入站消息的会话之间循环切换；
- 验证列表未读、当前会话和预览不冻结；
- 记录切换到首个可交互帧的耗时；
- 检查进程崩溃、ANR、Watchdog termination 和内存持续增长。

### 9.4 首轮门槛

代码内提供可配置门槛，默认值用于暴露明显回归而非宣称设备无关性能：

- E2E 操作超时：30 秒，登录/首次历史加载：60 秒；
- 业务请求失败率：小于 1%；
- Socket 连接失败率：小于 1%；
- `chat:send` ack p95：小于 1000 ms；
- Android 卡顿帧比例：小于 10%；
- 会话打开 p95：小于 1500 ms；
- 单场景执行期间进程 PSS/RSS 增长：小于 25%；
- 崩溃、ANR、Watchdog termination：0。

真机阶段必须固定设备型号、OS、构建类型、网络和数据规模，连续运行至少五次后记录正式基线。正式基线可收紧默认门槛，但不能为迁就回归而自动放宽。

## 10. 测试与验证策略

新增基础设施本身需要快速测试：

- Node 测试验证 E2E/负载环境门禁、生产域名拒绝、suite 参数与日志脱敏；
- Node 测试验证 locator contract 与源代码中的 `testID` 对齐；
- Node 测试验证性能报告解析、百分位和阈值判定；
- Maestro flow 使用 `maestro test --dry-run` 或等价语法检查；
- k6 脚本使用 `k6 inspect` 或等价静态加载检查；
- 现有 `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:behavior` 全部保持通过。

当前机器没有 iOS 运行环境时，iOS 脚本通过 shell 静态检查和参数单元测试验证；最终可执行性在 macOS/Xcode 环境确认。

## 11. CI 策略

本轮不会给普通 PR 增加必须拥有模拟器、账号或外部后端的阻断任务。CI 只加入：

- E2E 配置/定位器/运行器的快速测试；
- Maestro YAML 静态验证（工具可用时）；
- k6 脚本静态验证（工具可用时）。

真机稳定后再启用：

1. PR 或 release validation 的只读 `smoke`；
2. nightly 串行执行全部变更 E2E；
3. 手动触发负载测试；
4. 固定设备上的性能趋势任务。

CI 中每个并发 job 必须使用独立账号和测试资源，测试产物保留 run ID、截图、Maestro 输出、k6 summary 和平台 trace。

## 12. 非目标

首轮不自动化以下高风险或硬件依赖操作：

- 注销账号、转账、金币、支付、会员购买；
- 删除好友、拉黑真实用户；
- 相机、照片选择、麦克风、音视频通话和系统推送送达；
- 生产环境写操作；
- 为测试加入可由发布用户触发的后门或 mock 模式；
- 在没有固定设备基线时把性能数值设为 PR 硬门禁。

## 13. 验收标准

代码交付完成需满足：

- 六个业务 E2E suite 和三个性能 flow 均有完整 YAML；
- Android 与 iOS 共用 flow，并各自有可执行的构建/运行/采集入口；
- 所有关键 UI 元素拥有稳定 `testID`，且 locator contract 快速测试通过；
- E2E 与负载运行器在任何外部动作前拒绝缺失 opt-in、生产 origin、缺失夹具和无效凭证文件；
- 四个 k6 场景具备清晰阈值、指标和 summary 输出；
- 性能报告可解析 Android/iOS 采集结果并根据可配置门槛退出成功或失败；
- 示例配置不含真实秘密或 PII；
- 现有前端验证命令通过；
- 文档明确说明本地 Android、macOS iOS、负载和性能测试的运行方法；
- 未声称未实际执行的真机、iOS 或负载结果已经通过。

## 14. 维护决策

- UI E2E 保持业务流程级覆盖，不为每个组件复制设备测试；
- 快速单元/行为测试继续覆盖 reducer、store、映射、边界与错误处理；
- 业务 E2E 使用真实 UI 和真实测试环境，不通过直接写 store 制造成功状态；
- 性能数据准备允许使用受保护的正常 API/Socket 协议，但不改变 App 运行逻辑；
- mutating E2E、负载和性能准备不共享账号并发执行；
- 测试工具升级与生产依赖分离，Maestro/k6 作为外部 CLI 使用。
