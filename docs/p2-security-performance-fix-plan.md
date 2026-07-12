# P2 安全与性能修复实施计划

> **来源**:仓库级安全 + 性能审计(13 分区,对抗式验证)+ 7 项确认发现的独立复核。
> **范围**:仅 circle-im 移动客户端(Expo 55 / RN 0.83 / React 19 / TS)。后端(`circle_be`)另行处理。
> **日期**:2026-07-02
> **状态**:计划,尚未实现。
> **原则**:小、安全、可 review —— 每个修复尽量独立成 PR。

本文覆盖 8 项已确认的 P2 问题。每项给出:Finding ID / 待改文件 / 最小改法 / 安全影响 / 性能稳定性影响 / 回归风险 / 所需测试 / 手测步骤 / 是否发版前必修 / 需要客户端·原生·后端哪类改动。

---

## 建议的 PR 顺序(按风险/收益)

| PR | 包含 | 类型 | 回归风险 | 发版前 |
|----|------|------|---------|--------|
| PR-1 | Fix 1(HTTPS 强制) + Fix 2(console 剥离) | client + build | 低 | ✅ |
| PR-2 | Fix 7(解绑 IM 监听器) | client | 中 | ✅ |
| PR-3 | Fix 3(刷新单例污染) | client | 中 | ✅ |
| PR-4 | Fix 8(通话生命周期 + 幽灵来电) | client(+可选后端) | 中 | ✅ |
| PR-5 | Fix 4(金额幂等键) | client + **后端** | 低(客户端) | ✅ |
| PR-6 | Fix 5(PII 不落明文盘) | client | 中 | ✅ |
| PR-7 | Fix 6(聊天库排除备份) | **原生 config plugin** | 中 | ✅(公测前) |

> Fix 5 的「整库加密」版本改动面大(见该节),故拆成 PR-6 先做最小的「PII 不持久化」,整库加密作为后续项。

---

## Fix 1 — 强制 HTTPS/WSS(P4-02)

- **Finding ID**: P4-02
- **Files to change**: `src/constants/config.ts`(新增 scheme 断言);复用 `src/services/api/utils.ts` 的 `isPrivateIpv4`。**验证项**(不改代码):`app.json` iOS ATS、Android networkSecurityConfig(`ios/`、`android/` 被 gitignore,须在原生侧确认)。
- **Proposed approach**: 新增 `assertSecureUrl(url, { allowInsecurePrivateHost })` 辅助函数。在 `API_URL` / `OPENIM_API_URL` / `OPENIM_WS_URL` / `REALTIME_WS_URL` 计算完成后,当 `!__DEV__` 时断言协议 ∈ `{https:, wss:}`,否则(host 为私网 IP / localhost 的 dev 情形除外)在模块加载即 `throw` —— 让配置错误的 release **快速失败**而非静默走明文。dev 行为不变(私网 host 仍允许 http)。
- **Security impact**: 杜绝 release 误配下 Bearer token / 金额 body 走明文的 MITM 暴露。
- **Performance/stability impact**: 可忽略(仅模块加载一次校验)。
- **Regression risk**: **低-中**。风险点:正则/判定写错会误伤 dev(Expo Go / 私网 IP)启动,或误伤合法 staging。须保留私网 http 逃生口。
- **Required tests**: config 单测 —— `__DEV__=false + http://` → throw;`https://` → pass;`dev + 私网 IP http` → pass;https 输入派生出 wss。
- **Manual QA**: dev 真机(局域网 IP)仍能启动并连后端;staging(https)启动正常;(可选)故意用 http prod URL 构建 → 启动即报明确错误。
- **Before release**: ✅ 是。
- **Change type**: **client-only**(守卫);**外加原生验证**(iOS ATS 不得 `NSAllowsArbitraryLoads`,Android 不得 ship 宽松 networkSecurityConfig)。

## Fix 2 — release 剥离/集中 console.*(P11-01/02)

- **Finding ID**: P11-01, P11-02
- **Files to change**: `babel.config.js`(生产加 `transform-remove-console`);`src/utils/client-diagnostics.ts`(加 `__DEV__` 守卫 + 经 `redactSensitiveFields` 脱敏);可选新增 `src/utils/logger.ts` 统一入口 + `eslint.config.js` 禁裸 `console.*`。
- **Proposed approach**: (A) `babel.config.js` 在生产环境注入 `transform-remove-console`(可 `exclude:['error']` 或全剥,错误已由 `reportError`→Sentry 覆盖)—— 这是**兜底**,不依赖各处 `__DEV__` 守卫是否完备。(B) `client-diagnostics.ts:14` 用 `!__DEV__` 守卫并对值走按 key 脱敏,消除「未来调用者传 PII 就落 release 日志」的隐患(P11-02)。建议 A+B 都做。
- **Security impact**: release 无任何 console 输出;关闭 diagnostics footgun。当前泄漏面本就低(无 token/PII/服务端载荷),此为纵深防御。
- **Performance/stability impact**: 微降 bundle 体积 + 去掉热路径日志开销。
- **Regression risk**: **低**。风险:若全剥 `console.error` 可能少一条本地崩溃线索 —— 用 `exclude:['error']` 或依赖 Sentry 化解。须确认 `api.cache(true)` 与环境判定(`api.env('production')` / `NODE_ENV`)在 EAS 生产构建下正确命中。
- **Required tests**: 构建 release bundle,grep `[client-diagnostic]` / `console.warn` 字面量 → 不存在;单测 logger 在 `!__DEV__` 为 no-op;断言 diagnostics 已守卫。
- **Manual QA**: release 构建,登录/邀请/分享流程期间 `adb logcat` / Console.app → 无 `[client-diagnostic]`、`[openim]` 等 warning。
- **Before release**: ✅ 是。
- **Change type**: **client-only**。

## Fix 3 — 修复刷新单例跨账号污染(P2-01)

- **Finding ID**: P2-01
- **Files to change**: `src/services/api/client.ts`(reset + 写回守卫);`src/services/auth/session.ts`(触发 reset)。
- **Proposed approach**: 两道:
  1. **切号/登出时清空单例** —— client.ts 已 `import` session.ts,故在 client.ts 模块加载时用现成的 `registerLogoutHandler(() => { refreshPromise = null; })`(复用 teardown 钩子,**避免新的模块循环**);`clearLocalSession()` 会执行所有 handler,顺带清掉 in-flight refresh 引用。
  2. **写回前校验会话身份** —— `refreshAccessToken` 在创建 promise 时捕获当时的 `refreshToken`(client.ts:412);在 `setTokens(tokens)`(:450)前比对 `useAuthStore.getState().refreshToken === 捕获值`,不一致(会话已被切换/清空)则跳过写回并抛出,不污染新会话。即使 reset 竞态失手,这一层也能兜住。
- **Security impact**: 消除跨账号 token 污染(以错误用户身份鉴权)。
- **Performance/stability impact**: 顺带清理登出后残留的 in-flight refresh。
- **Regression risk**: **中**。必须保证常规 `401→refresh→retry` happy path 仍生效(守卫在会话未变时放行)。
- **Required tests**: (1) 竞态单测:A 的 refresh 在飞行中 → `switchToAccount(B)` → 断言 store 为 B 且 A 的 `setTokens` 被跳过;(2) happy path:普通 401 刷新仍更新 token 并重试;(3) 刷新中登出:`refreshPromise` 被置空。
- **Manual QA**: 双账号;在 A 制造后台流量(进消息页让轮询跑起来),快速反复切到 B;debug 构建下用网络面板确认无请求携带 A 身份、无跨账号数据串。
- **Before release**: ✅ 是。
- **Change type**: **client-only**。

## Fix 4 — 金额 POST 幂等键 + 安全重试(P4-01)

- **Finding ID**: P4-01
- **Files to change**: `src/services/api/client.ts`(`RequestOptions` 加 `idempotencyKey`,发为 `Idempotency-Key` header);`src/services/api/coin.ts`(`rechargePoints`、`sendCoinGift`);`src/services/api/membership.ts`(`upgradeMembership`);uuid 来源(建议加 `expo-crypto` 的 `randomUUID`,或复用现有 id util)。**后端**:必须对这三个端点按 `Idempotency-Key` 去重。
- **Proposed approach**: (a) `apiClient` 收到 `idempotencyKey` 时加 `Idempotency-Key` header。(b) 每笔金额操作在**调用点**(用户点击时)生成一个 UUID 传入 —— 因为内部 401 重试复用同一个 `options` 对象(client.ts:485 的 `{ ...options }`),**同一次操作的重试会携带同一个 key**,而两次独立点击生成不同 key。(c) 金额 POST 的 401 自动重试**保留**(刷新续期是好体验),但以幂等键保证重试安全;可加约定/lint:金额变更必须带 `idempotencyKey`。
- **Security impact**: 防止刷新竞态或重复提交导致的重复扣费/充值/升级。
- **Performance/stability impact**: 可忽略。
- **Regression risk**: **低**(客户端);真正的保护取决于后端是否按 key 去重 —— 后端忽略则无保护(但也无害)。
- **Required tests**: 单测 —— 金额 POST 带 `Idempotency-Key`;`401→refresh→retry` 复用**同一** key;两次独立调用生成**不同** key。集成(后端):同 key 两次 → 只生效一次。
- **Manual QA**: 弱网下点赠送/升级;用短 TTL token 在请求中途制造过期;确认余额只扣一次。
- **Before release**: ✅ 是(客户端 header 管道);完整保护需后端。
- **Change type**: **client + 后端**(后端须对 `/coin/recharge`、`/coin/gift`、`/membership/upgrade` 实现幂等去重 —— 须先与后端确认现状)。

## Fix 5 — 敏感字段不落明文盘(P5-2)

- **Finding ID**: P5-2
- **Files to change**(最小方案):`src/stores/authStore.ts`(`partialize`);`src/stores/knownAccountsStore.ts`(切换器只留展示字段)。
- **Proposed approach**: **重要约束** —— MMKV 在模块加载时**同步**创建(`src/storage/index.ts:10`)且各处同步使用(theme / i18n / zustand),而 expo-secure-store 是**异步**;要给整库加密,需把 `storage` 改成异步 bootstrap 的懒单例,并让 theme / i18n / authStore 等早期消费者等待初始化 —— **改动面大、启动时序风险高**。
  - **最小安全方案(推荐,先做)**:不加密整库,而是**不持久化 PII**。在 authStore `partialize`(:172-179)里去掉 `email` / `phoneNumber` / `wechat` / `qq` / `birthday` / `city`(或整个 `user` 仅保留 `id` / `nickname` / `avatarUrl` 等展示字段);SessionBootstrap 本就会在启动时 `/auth/me` 重新拉全量 profile。切换器(knownAccounts)只保留 `nickname` / `avatarUrl` 等非敏感展示字段。
  - **后续项(可选)**:整库加密 —— `createMMKV({ id, encryptionKey })`,key 由 expo-secure-store 生成/存取,配合启动期 bootstrap 改造 + 现有明文库迁移(`recrypt`)。
- **Security impact**: 从明文磁盘移除 email / 手机 / 社交号。
- **Performance/stability impact**: 最小方案可忽略;整库加密版有启动时序 + 迁移风险。
- **Regression risk**: 最小方案 **低-中** —— 须确保 profile 由 `/auth/me` 回填(离线时相关字段短暂为空),切换器仍能显示昵称/头像。
- **Required tests**: `partialize` 不含 PII;重启后 `authStore.user` 的 PII 字段在 `/auth/me` 返回前为 null;切换器仍列出账号(昵称/头像);dump MMKV 文件 grep 测试邮箱 → 无。
- **Manual QA**: 登录 → 杀进程 → 重启(离线):仍为已登录(token 在 Keychain),PII 字段联网后回填;导出/读取 MMKV 文件确认无 email/手机。
- **Before release**: ✅ 是(采用最小方案)。
- **Change type**: **client-only**。

## Fix 6 — 聊天库/敏感文件排除平台备份(P5-1)

- **Finding ID**: P5-1
- **Files to change**: 新增 config plugin `plugins/with-openim-backup-exclusion.js`(以现有 `plugins/with-local-sentry-auto-upload-disabled.js` 为模板,用 `withAndroidManifest` / `withDangerousMod`);`app.json` plugins 数组;可选 `src/im/client.ts:137-144`(生产降低 `isLogStandardOutput` / `OPENIM_LOG_LEVEL`)。
- **Proposed approach**:
  - **Android**:config plugin 用 `withAndroidManifest` 设 `android:allowBackup="false"`(最简)或加 `dataExtractionRules` / `fullBackupContent` 排除 `openim` 目录。
  - **iOS**:在 `RNFS.mkdir(dataDir)`(`src/im/client.ts:130`)后对该目录设 `NSURLIsExcludedFromBackupKey`。RNFS 无直接 API,故需一个小的原生 config plugin(AppDelegate 片段 / 微原生模块)。**不建议**改路径到 `Library/Caches`(聊天库可能被系统清除)。
  - 关键:`ios/`、`android/` 被 gitignore,因此把逻辑放进**受版本管理的 `plugins/`** config plugin,才能在 `prebuild` 时可靠重放。
- **Security impact**: 阻止明文聊天库 + SDK 日志进 iCloud / 电脑 / Android 云备份。
- **Performance/stability impact**: 无。
- **Regression risk**: **中**。`allowBackup=false` 会关闭该应用全部备份(IM 应用可接受,需文档说明);**不要**迁移路径以免孤立老用户数据。顺带把生产 SDK 日志降级。
- **Required tests**(原生):构建后验证 iOS `openim` 目录带排除属性 / Android manifest `allowBackup=false`;设备备份中不含该库。
- **Manual QA**: iOS 触发本地备份、确认不含 openim;Android `adb backup` 排除之;改后聊天仍正常(路径不变)。
- **Before release**: ✅ 是(至少公测前);可略晚于 Fix 5。
- **Change type**: **原生 config**(config plugin)+ 少量 client(日志级别)。

## Fix 7 — 登出时解绑 OpenIM 监听器(P7-1)

- **Finding ID**: P7-1
- **Files to change**: `src/im/listeners.ts`(导出解绑);`src/im/client.ts`(在 `logoutFromOpenIM` 的三个退出路径调用)。
- **Proposed approach**: (a) listeners.ts 导出 `export function unbindOpenIMListeners() { unbindAll?.(); }`(`unbindAll` 闭包已在末尾自置 null)。(b) client.ts `logoutFromOpenIM`(:225-254)有**三个**退出分支(:226-229、:234-238、:240-253),用一个本地 `finalizeIMTeardown()`(内容:`unbindOpenIMListeners(); initPromise = null; useIMStore.getState().reset();`)在每个分支替换现有的 `reset()`。因 `bindOpenIMListeners` 在 `unbindAll` 存在时早返回、置 null 后会重新绑定,下次 `ensureOpenIMInitialized → bindOpenIMListeners`(client.ts:135)会干净重绑;解绑幂等(已解绑时是 no-op),「从未初始化」分支调用也安全。
- **Security impact**: 阻止 `handleTokenExpired`(→ `clearLocalSession` + `router.replace('/(auth)/login')`,`src/im/listeners.ts:103-108`)和 store 变更在登出/切号后由迟到的 native 事件触发(跨账号状态串 / 误跳登录页)。
- **Performance/stability impact**: 修复永久监听器滞留(泄漏);保证重登时干净重绑。
- **Regression risk**: **中**。须验证重登后消息仍到达、无重复绑定(靠 `bindOpenIMListeners` 早返回守卫)、logout→login 后 `onConnectSuccess` 等仍触发。
- **Required tests**: 单测 —— bind → `unbindOpenIMListeners()` → 断言 11 个事件各 `OpenIMSDK.off` 且 `unbindAll` 置 null;再 bind → 断言重新注册。集成 —— 登出后模拟 `onUserTokenExpired` → 断言**无** `router.replace('/(auth)/login')`;重登后发消息 → 断言到达(已重绑)。
- **Manual QA**: 登录 → 登出 → 重登 → 收发消息(到达、未读徽标更新);A→B→A 切号无「会话过期」误弹;B 的消息不串进 A。
- **Before release**: ✅ 是。
- **Change type**: **client-only**。

## Fix 8 — 通话生命周期泄漏 + 幽灵来电弹窗(P10-1 / P10-2)

- **Finding ID**: P10-1, P10-2
- **Files to change**: `src/features/call/screens/GroupCallScreen.tsx`(离屏清理);`src/features/call/components/CallInviteHost.tsx`(过期定时器);建议在 `src/features/call/store/use-call-store.ts` 提取共享的 `leaveActiveCall` 帮助函数;`src/services/api/calls.ts` 无需改(`leaveCall` / `cancelCall` 已有)。**后端(可选)**:`GET /calls/current` 用于重连对账。
- **Proposed approach**:
  - **P10-1(幽灵成员)**:在**外层** `GroupCallScreen` 加离屏清理(unmount effect 或 `useFocusEffect` 返回):读 `useCallStore.getState().activeCall`,非空则 fire-and-forget 正确的离开调用(RINGING 且发起人 → `cancelCall`,否则 `leaveCall`)+ `resetCallState()`。因挂断路径 `handleLeave` 在 `router.back()`(:263)**之前**已 `resetCallState()`(:261)把 `activeCall` 置空,离屏时清理读到 null → **no-op**,天然避免重复 leave。把「通知后端离开」这段抽成 `handleLeave` 与清理**共用**的帮助函数。LiveKit 媒体房由 `<LiveKitRoom>` 卸载自动断开,故本修复只补「后端通知 + store 复位」。
  - **P10-2(幽灵来电)**:`CallInviteHost` 加 `useEffect`,以 `incomingCall?.callId` + `expiresAt` 为 key,`setTimeout(() => resetCallState() /* 可选 fire-and-forget rejectCall */, max(0, new Date(expiresAt).getTime() - Date.now()))`,在 accept / reject / unmount / incomingCall 变更时清除。即使终止推送丢失,过期也会自动收起弹窗。
  - **重连对账(P10-2 完整版)**:realtime 重连后与服务器对账通话状态,需后端 `GET /calls/current`(calls.ts 现无此端点)—— 标为**后端依赖增强项**;过期定时器为纯客户端的**主修复**。
- **Security impact**: 无(属正确性 / UX)。
- **Performance/stability impact**: 修复服务端幽灵 JOINED 成员、残留 `activeCall` 驱动的假通话 UI、以及卡死的全屏来电弹窗;使麦克风/房间释放路径确定。
- **Regression risk**: **中**。须确保离屏清理在正常挂断路径**不重复** leave(靠 reset-先于-back 的时序,须验证),进入通话(push)不误触清理;过期定时器须正确清除以免收起刚接听的通话。
- **Required tests**: (P10-1) 进通话 → 用系统返回手势离开 → 断言 `leaveCall` 恰调用一次且 `activeCall===null`;挂断路径 → 断言 leave 恰一次(不重复)。(P10-2) `expiresAt` 临近且无 end 事件 → 弹窗自动收起 + 状态清空;过期前接听 → 定时器清除、不收起。
- **Manual QA**: 双机 —— A 呼 B,B 用返回手势离开通话 → A 侧 B 被移除(无幽灵);A 呼 B 后 A 取消且 B 网络抖动 → B 的来电弹窗在过期时自动消失(不卡死全屏);正常接听不被自动收起。
- **Before release**: ✅ 是。
- **Change type**: 两个主修复 **client-only**;重连对账需 **后端**(`GET /calls/current`)。

---

## 汇总矩阵

| Fix | Finding | 发版前 | 改动类型 | 回归风险 | 关键测试 |
|-----|---------|:---:|---------|:---:|---------|
| 1 | P4-02 | ✅ | client + 原生验证 | 低-中 | config 单测(release+http→throw) |
| 2 | P11-01/02 | ✅ | client / build | 低 | release bundle grep 无 console |
| 3 | P2-01 | ✅ | client | 中 | 切号竞态单测 |
| 4 | P4-01 | ✅ | client + **后端** | 低(client) | 401 重试复用同一幂等键 |
| 5 | P5-2 | ✅ | client | 中 | dump MMKV 无 PII |
| 6 | P5-1 | ✅ | **原生 plugin** | 中 | 备份不含 openim 库 |
| 7 | P7-1 | ✅ | client | 中 | 登出解绑 / 重登重绑 |
| 8 | P10-1/2 | ✅ | client(+可选后端) | 中 | 返回手势离开→leave 一次 |

### 跨团队依赖

- **需要后端协作**:Fix 4(端点按 `Idempotency-Key` 去重 —— 须先确认 `circle_be` 现状)、Fix 8 的重连对账(新增 `GET /calls/current`,非必需)。
- **需要原生配置**:Fix 6(备份排除 config plugin;因 `ios/`、`android/` 被 gitignore,必须走 `plugins/`)。
- **其余全部 client-only**。
