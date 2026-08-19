# WindNote E2E、负载与客户端性能测试实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 WindNote 提供 Android/iOS 共用的 Maestro 业务 E2E、聊天与圈子 k6 负载场景，以及双平台客户端性能采集与可验证的安全运行器。

**Architecture:** 应用代码只增加稳定 `testID`，不增加测试后门；跨平台 Node 运行器在调用外部工具前执行非生产环境、凭证和写操作门禁。Maestro 驱动真实 UI，k6 通过现有 REST 与 Socket.IO 契约制造负载，Android/iOS 平台脚本采集原生性能数据并由共享 Node 解析器判定门槛。

**Tech Stack:** Expo 55、React Native 0.83、TypeScript、Node 22 test runner、Maestro YAML、k6 JavaScript、PowerShell、POSIX shell、ADB/Perfetto、Xcode xctrace。

## Global Constraints

- Android 与 iOS 共用同一组 Maestro 业务 flow，应用 ID 为 `com.yiboding.circleim`。
- 本轮不要求执行真机、iOS 或真实负载测试，也不把它们加入普通 PR 的强制门禁。
- UI E2E、负载和性能准备默认拒绝生产 origin 与缺失的显式 opt-in。
- 不提交真实账号、验证码、access token、消息正文或用户 PII。
- 不增加生产用户可触发的 mock、fixture 或测试专用业务路径。
- 变更型 E2E 在同一账号上串行执行；负载测试使用专用账号池。
- 当前本机依赖目录不完整，基线 `npm test` 只有 `test/android-release-workflow.test.js` 因缺少 `expo/config-plugins` 失败；安装锁定依赖后必须重新验证。

---

### Task 1: 安全配置解析与跨平台运行器

**Files:**
- Create: `scripts/testing/safe-test-config.mjs`
- Create: `scripts/run-e2e.mjs`
- Create: `scripts/run-load.mjs`
- Create: `test/safe-test-config.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseE2EConfig(env, suite)`、`parseLoadConfig(env, scenario)`、`redactTestValue(value)`。
- Produces: `npm run e2e -- <suite>` 与 `npm run load:test -- <scenario>`。
- Consumes: environment maps only; external processes are spawned only after successful validation.

- [ ] **Step 1: Write the failing configuration tests**

```js
test('mutating E2E rejects production before starting Maestro', async () => {
  const { parseE2EConfig } = await import('../scripts/testing/safe-test-config.mjs');
  assert.throws(() => parseE2EConfig({
    E2E_EXECUTE: 'true',
    E2E_ALLOW_MUTATION: 'true',
    E2E_API_URL: 'https://api.windnote.ai',
    E2E_ALLOWED_ORIGINS: 'https://e2e-api.windnote.test',
  }, 'chat-message'), /not allowlisted/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/safe-test-config.test.js`

Expected: FAIL because `scripts/testing/safe-test-config.mjs` does not exist.

- [ ] **Step 3: Implement minimal pure validation**

Implement exact suite metadata for `smoke`, `auth-navigation`, `chat-message`, `moment-lifecycle`, `profile-settings`, `social-circle`, plus performance suites. Require exact boolean strings, HTTPS/WSS origins, explicit allowlist membership, matching REST/Socket hosts, valid run IDs, required auth fields, and fixture IDs. Load scenarios are `chat-send`, `chat-fan-in`, `circle-join`, `inbox-seed`.

- [ ] **Step 4: Run GREEN and add runner integration tests**

Run: `node --test test/safe-test-config.test.js`

Expected: PASS, including production rejection, mutation opt-in, missing fixture, token redaction and read-only smoke cases.

- [ ] **Step 5: Add process runners and package scripts**

`run-e2e.mjs` executes:

```js
spawnSync('maestro', ['test', '-e', `APP_ID=${config.appId}`, ...config.envArgs, config.flow], {
  stdio: 'inherit', shell: process.platform === 'win32',
});
```

`run-load.mjs` executes `k6 run` with validated environment and scenario path. Add `e2e`, `e2e:smoke`, `load:test`, `test:testing-tools` package scripts.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:testing-tools`

Expected: PASS.

Commit: `test(infra): add guarded E2E and load runners`

---

### Task 2: 稳定 UI 定位器契约

**Files:**
- Create: `src/testing/e2e-test-ids.ts`
- Create: `e2e/locator-contract.json`
- Create: `test/e2e-locator-contract.test.js`
- Modify: `src/components/ui/auth-input.tsx`
- Modify: `src/components/ui/menu-row.tsx`
- Modify: `src/features/auth/screens/LoginScreen.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `src/features/messages/screens/MessagesScreen.tsx`
- Modify: `src/features/chat/screens/ChatDetailScreen.tsx`
- Modify: `src/features/contacts/screens/ContactsScreen.tsx`
- Modify: `src/features/discover/screens/DiscoverScreen.tsx`
- Modify: `src/features/discover/screens/CreateMomentScreen.tsx`
- Modify: `src/features/discover/screens/MomentDetailScreen.tsx`
- Modify: `src/features/discover/screens/UserMomentsScreen.tsx`
- Modify: `src/features/profile/screens/ProfileScreen.tsx`
- Modify: `src/features/profile/screens/AppSettingsScreen.tsx`
- Modify: `src/features/profile/screens/NotificationSettingsScreen.tsx`
- Modify: `src/features/profile/screens/PrivacySettingsScreen.tsx`
- Modify: `src/features/profile/screens/EditProfileFieldScreen.tsx`
- Modify: `src/features/profile/components/settings-detail.tsx`
- Modify: `src/features/social/screens/AddFriendScreen.tsx`
- Modify: `src/features/user/screens/UserProfileScreen.tsx`
- Modify: `src/features/discover/screens/DiscoverCirclesScreen.tsx`
- Modify: `src/features/discover/screens/CircleDetailScreen.tsx`

**Interfaces:**
- Produces: `E2E_TEST_IDS` frozen string catalog and dynamic ID helpers.
- Consumes: native `testID` props only; no environment flags or test-only behavior.

- [ ] **Step 1: Write the failing locator contract test**

The test loads `e2e/locator-contract.json`, asserts uniqueness and `windnote.` prefix, reads the catalog and source files, and proves every required locator is declared and referenced.

- [ ] **Step 2: Run RED**

Run: `node --test test/e2e-locator-contract.test.js`

Expected: FAIL because the catalog and locator contract do not exist.

- [ ] **Step 3: Add the catalog and prop forwarding**

Add `testID?: string` to `AuthInput` and `MenuRow`, forwarding to `TextInput`/`Pressable`. Add `rowTestID?: (id: string) => string` or a direct row `testID` in the smallest existing settings abstraction.

- [ ] **Step 4: Add locators to real surfaces**

Add identifiers for login modes/inputs/submit, four tabs, root screens, conversation list/rows, chat input/send/back, moment create/content/publish/detail/delete/confirm, profile/settings/edit/notification/privacy, friend search/profile, circle search/detail/chat entry.

- [ ] **Step 5: Run GREEN and existing focused UI tests**

Run: `node --test test/e2e-locator-contract.test.js test/messages-screen.test.js test/chat-detail-screen.test.js test/login-screen-brand-icon.test.js`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `test(e2e): expose stable WindNote UI locators`

---

### Task 3: Android/iOS 共享 Maestro 业务流程

**Files:**
- Create: `.maestro/config.yaml`
- Create: `.maestro/subflows/launch.yaml`
- Create: `.maestro/subflows/sign-in.yaml`
- Create: `.maestro/subflows/ensure-signed-in.yaml`
- Create: `.maestro/subflows/open-seeded-conversation.yaml`
- Create: `.maestro/subflows/sign-out.yaml`
- Create: `.maestro/flows/smoke.yaml`
- Create: `.maestro/flows/auth-navigation.yaml`
- Create: `.maestro/flows/chat-message.yaml`
- Create: `.maestro/flows/moment-lifecycle.yaml`
- Create: `.maestro/flows/profile-settings.yaml`
- Create: `.maestro/flows/social-circle.yaml`
- Create: `test/maestro-flows.test.js`

**Interfaces:**
- Consumes: `E2E_TEST_IDS`, validated environment passed by `run-e2e.mjs`.
- Produces: independently executable, shared Android/iOS flows.

- [ ] **Step 1: Write failing static flow tests**

Assert six flow files exist, each uses `${APP_ID}`, no flow contains production URL, mutable flows include `${E2E_RUN_ID}`, selectors exist in the locator contract, and subflow paths resolve.

- [ ] **Step 2: Run RED**

Run: `node --test test/maestro-flows.test.js`

Expected: FAIL because `.maestro/flows` does not exist.

- [ ] **Step 3: Implement shared auth and navigation flows**

Use `runFlow` conditions to sign in only when `windnote.auth.login.screen` is visible. Use exact environment values; do not fall back from password to code login. Restart without clearing state to prove session restoration.

- [ ] **Step 4: Implement mutating closed loops**

Chat sends `WINDNOTE-E2E-CHAT-${E2E_RUN_ID}` and verifies after reopening. Moment creates `WINDNOTE-E2E-MOMENT-${E2E_RUN_ID}` and deletes it. Profile uses `${E2E_ORIGINAL_NICKNAME}` for explicit restoration and toggles the same notification/privacy control twice.

- [ ] **Step 5: Implement read-only social flow**

Select the friend and circle by dynamic locator IDs derived from `${E2E_FRIEND_ID}` and `${E2E_CIRCLE_ID}`; never select the first row.

- [ ] **Step 6: Run GREEN and optional CLI validation**

Run: `node --test test/maestro-flows.test.js`

Expected: PASS.

If `maestro` is installed, run `maestro test --help` and the supported static validation command without launching an app; otherwise record that device validation remains deferred.

- [ ] **Step 7: Commit**

Commit: `test(e2e): add cross-platform WindNote journeys`

---

### Task 4: Socket.IO 协议工具与负载数据契约

**Files:**
- Create: `load-tests/lib/config.js`
- Create: `load-tests/lib/data.js`
- Create: `load-tests/lib/socket-io.js`
- Create: `load-tests/lib/thresholds.js`
- Create: `load-tests/data/accounts.example.json`
- Create: `test/load-test-protocol.test.js`

**Interfaces:**
- Produces: Socket.IO Engine.IO packet encoder/parser for open (`0`), ping/pong (`2`/`3`), namespace connect (`40`), event (`42`), event with ack ID (`42<id>`), and ack (`43<id>`).
- Produces: validated account records `{ alias, accessToken, conversationId, circleIds }`.

- [ ] **Step 1: Write failing protocol tests**

```js
assert.equal(encodeConnect('token'), '40{"token":"token"}');
assert.equal(encodeEvent('chat:send', payload, 7), `427["chat:send",${JSON.stringify(payload)}]`);
assert.deepEqual(parseSocketPacket('437[{"ok":true}]'), { type: 'ack', ackId: 7, data: [{ ok: true }] });
```

- [ ] **Step 2: Run RED**

Run: `node --test test/load-test-protocol.test.js`

Expected: FAIL because the protocol module does not exist.

- [ ] **Step 3: Implement minimal protocol and account validation**

Reject malformed JSON, unknown packet types, empty tokens, duplicate aliases, missing conversation IDs, and plaintext public URLs. Redact tokens from all thrown messages.

- [ ] **Step 4: Run GREEN**

Run: `node --test test/load-test-protocol.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `test(load): add Socket.IO load protocol support`

---

### Task 5: k6 聊天、汇聚、加入与性能夹具场景

**Files:**
- Create: `load-tests/scenarios/chat-send.js`
- Create: `load-tests/scenarios/chat-fan-in.js`
- Create: `load-tests/scenarios/circle-join.js`
- Create: `load-tests/scenarios/inbox-seed.js`
- Create: `test/load-test-scenarios.test.js`
- Create: `scripts/prepare-performance-fixture.mjs`

**Interfaces:**
- Consumes: validated accounts JSON, `CHAT_WS_PATH=/chat-ws`, `chat:send`, `chat:msg`, `/circle/:id/join`, `/circle/:id/leave`, `/circle/my?tab=joined`, `/chat/conversations`.
- Produces: k6 custom metrics and redacted JSON summary; `inbox-seed` produces a token-free manifest.

- [ ] **Step 1: Write failing scenario contract tests**

Assert each scenario imports common config/thresholds, defines explicit `options.scenarios`, uses unique delivery IDs, and has cleanup where required. Assert inbox manifest writer removes `accessToken` recursively.

- [ ] **Step 2: Run RED**

Run: `node --test test/load-test-scenarios.test.js`

Expected: FAIL because scenario files do not exist.

- [ ] **Step 3: Implement `chat-send` and `chat-fan-in`**

Track `socket_connect_failures`, `chat_ack_duration`, `chat_delivery_duration`, `chat_duplicate_deliveries`, `chat_missing_deliveries`, and `socket_unexpected_disconnects`. Respond to Engine.IO ping and close sockets at bounded duration.

- [ ] **Step 4: Implement `circle-join` and cleanup**

Classify 2xx, 409/business rejection, 429, and 5xx. Poll joined circles and conversation list for eventual consistency. Leave only memberships created by the current run.

- [ ] **Step 5: Implement `inbox-seed` and manifest**

Use configurable target counts limited to 1000 conversations and 200 messages per conversation per run. The runner requires an additional `LOAD_PERFORMANCE_FIXTURE=true` opt-in for the 500/1000 scale.

- [ ] **Step 6: Run GREEN and k6 inspect when available**

Run: `node --test test/load-test-scenarios.test.js`

Expected: PASS.

If k6 is installed: `k6 inspect load-tests/scenarios/chat-send.js` and repeat for all scenarios. Expected: each exits 0 without network traffic.

- [ ] **Step 7: Commit**

Commit: `test(load): cover chat fan-in and circle join pressure`

---

### Task 6: 客户端性能 flow、采集脚本与报告判定

**Files:**
- Create: `.maestro/performance/conversation-list-scroll.yaml`
- Create: `.maestro/performance/chat-history-scroll.yaml`
- Create: `.maestro/performance/conversation-switch-storm.yaml`
- Create: `scripts/testing/performance-report.mjs`
- Create: `scripts/perf-android.ps1`
- Create: `scripts/perf-ios.sh`
- Create: `test/performance-report.test.js`
- Create: `test/performance-scripts.test.js`

**Interfaces:**
- Produces: `parseAndroidGfxInfo(text)`, `parseAndroidMemInfo(text)`, `parseIosMetrics(text)`, `evaluatePerformance(metrics, thresholds)`.
- Produces: JSON result containing platform, build, device, run ID, frame/memory/latency metrics and threshold failures.

- [ ] **Step 1: Write failing parser and script contract tests**

Use checked-in inline samples of `dumpsys gfxinfo`, `dumpsys meminfo`, and xctrace-exported tabular metrics. Assert janky frame ratio, memory growth and failure messages.

- [ ] **Step 2: Run RED**

Run: `node --test test/performance-report.test.js test/performance-scripts.test.js`

Expected: FAIL because parsers/scripts do not exist.

- [ ] **Step 3: Implement report parser and thresholds**

Defaults: janky frames `<10%`, open conversation p95 `<1500ms`, memory growth `<25%`, crash/ANR/watchdog count `0`; allow environment overrides only as positive finite values.

- [ ] **Step 4: Implement Android collector**

Validate exactly one selected `adb` device, reset gfxinfo, record baseline meminfo, run selected Maestro performance flow, collect post-run gfxinfo/meminfo, optionally capture Perfetto, and always write artifacts under an explicit result directory.

- [ ] **Step 5: Implement iOS collector**

Require macOS, `xcrun`, an explicit simulator UDID and installed app. Record xctrace Time Profiler/Core Animation data around the same Maestro flow, export metrics, and call the shared report evaluator.

- [ ] **Step 6: Implement three shared performance flows**

Use fixed repeat counts and dynamic seeded conversation IDs; flows assert the composer remains interactive and capture named screenshots.

- [ ] **Step 7: Run GREEN and shell syntax checks**

Run: `node --test test/performance-report.test.js test/performance-scripts.test.js`

Run on Windows: PowerShell parser validation for `scripts/perf-android.ps1`.

Run where available: `bash -n scripts/perf-ios.sh`.

Expected: PASS.

- [ ] **Step 8: Commit**

Commit: `test(perf): add cross-platform chat UI performance harness`

---

### Task 7: 文档、CI 快速门禁与完整验证

**Files:**
- Create: `e2e/README.md`
- Create: `e2e/env.example`
- Create: `e2e/fixtures.md`
- Create: `load-tests/README.md`
- Modify: `.gitignore`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/testing-docs.test.js`

**Interfaces:**
- Produces: reproducible Android, macOS/iOS, k6 and performance commands.
- CI consumes only fast, no-device, no-network test contracts.

- [ ] **Step 1: Write failing documentation/config tests**

Add Node assertions that secret-bearing files/results are ignored, example values are fake, README names all commands, and CI runs `npm run test:testing-tools` without credentials.

- [ ] **Step 2: Run RED**

Run: `node --test test/testing-docs.test.js`

Expected: FAIL until docs and ignore rules exist.

- [ ] **Step 3: Add docs and CI fast gate**

Document install prerequisites, environment fields, fixture preparation, each suite, safe load ramp-up, Android collection, macOS iOS collection, artifact interpretation and deferred real-device verification. Add only the fast contract test to existing CI.

- [ ] **Step 4: Install locked dependencies**

Run: `npm ci`

Expected: exit 0 and `npm ls expo @expo/config-plugins --depth=1` shows installed packages. If sandboxed network blocks it, rerun with explicit escalation.

- [ ] **Step 5: Run focused and full verification**

Run in order:

```text
npm run test:testing-tools
npm run typecheck
npm run expo:config
npm run lint
npm test
npm run test:behavior
```

Expected: all commands exit 0. Do not claim device, iOS or load execution passed because those runs are deferred.

- [ ] **Step 6: Review the diff against the design**

Verify all six business suites, three performance flows, four load scenarios, two platform collectors, security guards, fake examples and docs are present. Scan for tokens, production URLs in executable configs, placeholders and unrelated changes.

- [ ] **Step 7: Commit**

Commit: `docs(test): document WindNote E2E load and performance runs`
