# WindNote E2E 与客户端性能测试

这套测试使用 Maestro YAML，同一组业务流程同时服务 Android 和 iOS。选择器只使用 `src/testing/e2e-test-ids.ts` 中的稳定 `testID`；快速契约测试会阻止 locator 漂移。当前已完成代码与静态验证，Android/iOS 真机、模拟器和负载环境执行尚未进行，按计划 deferred 到专用测试环境。

## 前置条件

- Node.js 22、已执行 `npm ci`。
- Maestro CLI；Android 需要 `adb`，iOS 需要 macOS、Xcode、`xcrun` 和已启动的 Simulator。
- 安装指向专用非生产后端的 release-like App。App 构建时的 `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_CHAT_WS_URL` 必须与测试目标一致；`E2E_API_URL` 只承担运行前安全校验，不会重写已安装二进制的配置。
- 该 App 构建时还必须设置 `EXPO_PUBLIC_E2E_BUILD=1`（与 `EXPO_PUBLIC_API_URL` 一样是编译期变量，在 `expo prebuild` / `gradlew assembleRelease` / `expo run:android --variant release` 的环境里注入）。每条流程启动后都会断言根布局上的运行时目标标记（`E2E_API_TARGET_ID`），该标记只在 dev 构建或 `EXPO_PUBLIC_E2E_BUILD=1` 的构建里渲染；用商店/正式包跑 Maestro 会在 `launch` 子流程处失败。
- 按 [fixtures.md](./fixtures.md) 准备独立账号、会话、好友和圈子。

先复制 `e2e/env.example` 为被 git 忽略的 `e2e/.env`，替换假值。文件默认所有执行开关均为 `false`。Node 22 可这样加载：

```sh
node --env-file=e2e/.env scripts/run-e2e.mjs smoke
node --env-file=e2e/.env scripts/run-e2e.mjs all
```

若环境变量已由 shell/CI 注入，也可使用：

```sh
npm run test:testing-tools
npm run e2e:smoke
npm run e2e:all
```

## 六条业务 E2E

| Suite | 内容 | 是否写数据 |
| --- | --- | --- |
| `smoke` | 启动，识别登录页或已登录主页 | 否 |
| `auth-navigation` | 两种登录模式、四个 Tab、会话恢复、退出 | 退出会清本地会话 |
| `chat-message` | 发送带 run ID 的文本，退出重进后仍可见 | 是 |
| `moment-lifecycle` | 发布带 run ID 的动态并删除 | 是，自动清理 |
| `profile-settings` | 改昵称、恢复原昵称、设置开关往返 | 是，自动恢复 |
| `social-circle` | 精确好友检索、精确圈子检索和进入聊天 | 否 |

任何写场景都要求 `E2E_EXECUTE=true`、`E2E_ALLOW_MUTATION=true` 和合法 `E2E_RUN_ID`。目标必须为 HTTPS/WSS allowlist 中的同一非生产主机；生产 WindNote 域名不会被接受。

## Android UI 性能

先用 `load:inbox-seed` 准备大会话列表，再设定 `PERF_DEVICE_ID` 和独立结果目录：

```powershell
$env:PERF_RESULTS_DIR = 'test-results/android-conversation-list'
$env:PERF_DEVICE_ID = 'emulator-5554'
$env:PERF_SUITE = 'conversation-list-scroll'
$env:PERF_CAPTURE_PERFETTO = 'true'
npm run perf:android
```

可选 suite：`conversation-list-scroll`、`chat-history-scroll`、`conversation-switch-storm`。脚本会重置并采集 `dumpsys gfxinfo`，对比 `dumpsys meminfo` PSS，扫描 logcat 的 crash/ANR，可选保存 Perfetto trace，并输出 `performance-report.json`。

## iOS UI 性能

只能在 macOS 执行，`PERF_DEVICE_ID` 必须为一个已启动 Simulator UDID：

```sh
export PERF_RESULTS_DIR=test-results/ios-conversation-list
export PERF_DEVICE_ID=00000000-0000-0000-0000-000000000000
export PERF_SUITE=conversation-list-scroll
npm run perf:ios
```

脚本使用 `xcrun xctrace record --template 'Animation Hitches'` 录制 trace、导出 TOC，采集进程前后 RSS 和系统 crash/watchdog 日志。不同 Xcode 版本的 xctrace XML schema 不稳定，因此不伪造自动 hitch 数值：原始 trace 必须在 Instruments 中验收；如实验室已有可信导出，可通过 `PERF_IOS_JANK_PERCENT` 和 `PERF_OPEN_P95_MS` 写入统一报告。

默认判定线为 janky frame `<10%`、打开会话 p95 `<1500ms`、内存增长 `<25%`、crash/ANR/watchdog `0`。缺失指标会进入 `unavailableMetrics`，不能视为该指标已通过。
