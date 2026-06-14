# 设置页占位功能补全实现计划

> **给 agentic workers：** 必须使用子技能 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实现本计划。任务步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 把「我的 > 设置」里剩余的占位行补成真实页面、持久化设置，或明确的后端动作。

**架构：** 继续让设置详情页通过 `SettingsDetailScreen` 声明式渲染；复杂流程不要塞进菜单页，而是路由到独立页面。纯本地偏好放在 `useAppSettingsStore` 里持久化；账号、好友、设备等真实动作通过 `src/services/api/*` 接口层执行，并且只在接口成功后刷新或清理相关 store。

**技术栈：** Expo Router、React Native、Zustand persist + MMKV、现有 `apiClient`、Node test runner 文本级测试、`npx tsc --noEmit`、针对改动文件的 ESLint。

---

## 当前剩余占位清单

这些行目前仍会走 `SettingsDetailScreen` 的默认“暂未接入”提示，或者只是显示静态值：

| 区域 | 行 id | 当前状态 | 实现类型 |
| --- | --- | --- | --- |
| 账号与安全 | `login-device-management` | 没有路由/动作 | 需要后端契约，或先用 `logoutAll` 做降级 MVP |
| 账号与安全 | `wechat-binding` | 没有路由/动作 | 需要微信 OAuth/后端契约 |
| 账号与安全 | `cancel-account` | 没有路由/动作 | 需要危险后端动作 |
| 消息通知 | `message-ringtone`、`circle-ringtone` | 静态值 | 本地选择器 + 持久化；后续可接真实音频资源 |
| 界面与显示 | `display-mode`、`font-size`、`global-chat-background`、`pinned-fold-count` | 静态值 | 本地选择器/store；全局聊天背景可复用聊天背景能力 |
| 隐私设置 | `self-destruct`、`moments-visibility`、`add-me-methods`、`call-permission`、`group-invite-permission` | 静态值/无动作链接 | 后端契约未定前先做本地选择器/store |
| 隐私设置 | `blacklist` | 没有路由/动作 | 已有拉黑/移除接口，但缺列表接口和页面 |
| 关于我们 | `version` | 可点击，但应为纯信息 | 改成 `type: 'info'` |
| 关于我们 | `user-agreement`、`privacy-policy` | 没有路由/动作 | 静态法律页或远程 URL |
| 关于我们 | `check-updates` | 静态“已是最新” | 需要 Expo/应用商店更新策略；否则改为信息行 |
| 系统权限 | 各权限行 | 行本身可点，但只有底部按钮打开系统设置 | 权限行改成 `type: 'info'`，底部保留 `Linking.openSettings()` |

## 文件规划

- 修改：`src/features/profile/screens/AccountSecuritySettingsScreen.tsx`
  - 接入设备管理、微信绑定、注销账号。
- 新建：`src/features/profile/screens/LoginDeviceManagementScreen.tsx`
  - 展示设备/会话列表，或 MVP 版“退出其他设备”。
- 新建：`app/(tabs)/profile/settings-login-devices.tsx`
  - 设备管理路由导出。
- 新建：`src/features/profile/screens/WechatBindingScreen.tsx`
  - 微信绑定状态、绑定/解绑动作。
- 新建：`app/(tabs)/profile/settings-wechat-binding.tsx`
  - 微信绑定路由导出。
- 新建：`src/features/profile/screens/CancelAccountScreen.tsx`
  - 注销账号危险确认流程。
- 新建：`app/(tabs)/profile/settings-cancel-account.tsx`
  - 注销账号路由导出。
- 修改：`src/services/api/auth.ts`
  - 后端契约确认后新增账号、设备、绑定相关 API helper。
- 修改：`src/features/profile/screens/NotificationSettingsScreen.tsx`
  - 增加铃声选择器和持久化值。
- 修改：`src/features/profile/screens/AppearanceSettingsScreen.tsx`
  - 增加显示模式、字体大小、置顶折叠数、全局聊天背景设置。
- 修改：`src/features/profile/store/use-app-settings-store.ts`
  - 在现有 boolean 设置旁增加 enum/string 类型设置。
- 修改：`src/features/profile/screens/PrivacySettingsScreen.tsx`
  - 增加隐私相关选择器和黑名单路由。
- 新建：`src/features/profile/screens/BlacklistSettingsScreen.tsx`
  - 展示黑名单用户并支持移除。
- 新建：`app/(tabs)/profile/settings-blacklist.tsx`
  - 黑名单路由导出。
- 修改：`src/services/api/friends.ts`
  - 后端 endpoint 确认后新增 `fetchBlockedFriends()`。
- 修改：`src/features/profile/screens/AboutSettingsScreen.tsx`
  - 正确标记信息行，并接入法律页/更新检查。
- 新建：`src/features/profile/screens/LegalDocumentScreen.tsx`
  - 如果不走远程 URL，则用一个可复用的本地法律文档页。
- 新建：`app/(tabs)/profile/legal/[document].tsx`
  - 动态法律文档路由。
- 修改：`src/features/profile/screens/SystemPermissionsScreen.tsx`
  - 权限行改为纯信息行。
- 修改：`src/i18n/locales/zh.json`、`src/i18n/locales/en.json`
  - 增加所有标题、选项、警告、空状态文案。
- 修改：`test/profile-settings-screen.test.js`
  - 为每个行的真实动作/路由/信息行语义加回归测试。
- 按需新增测试：
  - `test/auth-api.test.js`
  - `test/friend-settings-screen.test.js`
  - 如果 `profile-settings-screen.test.js` 过宽，可新增 `test/profile-settings-placeholders.test.js`。

---

### 任务 1：用测试锁定剩余占位清单

**文件：**
- 修改：`test/profile-settings-screen.test.js`

- [ ] **步骤 1：写失败测试**

新增测试，断言当前列出的占位行必须满足以下至少一种情况：
- 是 `type: 'info'`
- 有 `onPress`
- 是 `type: 'toggle'` 且使用受控 `value`

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
node --test test/profile-settings-screen.test.js
```

预期：测试因为“当前剩余占位清单”中的行尚未处理而失败。

- [ ] **步骤 3：必要时抽取行 id 常量**

如果正则测试变得难维护，就把每个设置页的 row id 抽成常量，再对这些常量做断言。

- [ ] **步骤 4：每完成一个任务后重复运行测试**

运行：

```bash
node --test test/profile-settings-screen.test.js
```

预期：随着后续任务完成，未处理的占位行数量逐步减少。

---

### 任务 2：账号与安全动作

**文件：**
- 修改：`src/features/profile/screens/AccountSecuritySettingsScreen.tsx`
- 新建：`src/features/profile/screens/LoginDeviceManagementScreen.tsx`
- 新建：`src/features/profile/screens/WechatBindingScreen.tsx`
- 新建：`src/features/profile/screens/CancelAccountScreen.tsx`
- 新建：`app/(tabs)/profile/settings-login-devices.tsx`
- 新建：`app/(tabs)/profile/settings-wechat-binding.tsx`
- 新建：`app/(tabs)/profile/settings-cancel-account.tsx`
- 修改：`src/services/api/auth.ts`
- 修改：`src/i18n/locales/zh.json`
- 修改：`src/i18n/locales/en.json`
- 测试：`test/profile-settings-screen.test.js`
- 测试：`test/auth-api.test.js`

- [ ] **步骤 1：确认后端契约**

需要确认的接口：
- 设备列表：例如 `GET /auth/devices`
- 撤销设备：例如 `DELETE /auth/devices/:id`
- 退出其他设备降级方案：已有 `POST /auth/logout-all`
- 微信绑定状态/发起绑定/解绑：endpoint 待定
- 注销账号：endpoint 待定，可能是危险的 `DELETE /auth/me`

不要在生产代码里臆造 endpoint。

- [ ] **步骤 2：写 API helper 失败测试**

在 `test/auth-api.test.js` 中断言每个 helper 调用了约定的 endpoint 和 method。

- [ ] **步骤 3：实现 API helper**

在 `src/services/api/auth.ts` 中添加聚焦 helper，响应校验风格保持和现有 auth helper 一致。

- [ ] **步骤 4：写路由导出测试**

在 `test/profile-settings-screen.test.js` 中断言 3 个新增路由文件分别导出对应 screen。

- [ ] **步骤 5：实现页面**

设备管理：
- 加载设备列表。
- 如果后端标记当前设备，要单独展示。
- 支持撤销其他设备。
- 只有产品接受“退出所有其他设备”作为 MVP 时，才直接使用 `logoutAll()`。

微信绑定：
- 展示当前绑定状态。
- 只有 OAuth callback 契约明确后，才接 `Expo WebBrowser` / `Linking`。
- 如果后端支持解绑，增加解绑确认。

注销账号：
- 至少两次确认。
- 成功后调用 `clearLocalSession()` 并跳转登录页。
- 不允许只在菜单行里弹一个简单 Alert 完事。

- [ ] **步骤 6：接入设置行**

在 `AccountSecuritySettingsScreen.tsx` 中给对应行增加：

```ts
onPress: () => router.push(...)
```

- [ ] **步骤 7：验证**

运行：

```bash
node --test test/auth-api.test.js test/profile-settings-screen.test.js
npx tsc --noEmit
npx eslint src/features/profile/screens/AccountSecuritySettingsScreen.tsx src/features/profile/screens/LoginDeviceManagementScreen.tsx src/features/profile/screens/WechatBindingScreen.tsx src/features/profile/screens/CancelAccountScreen.tsx src/services/api/auth.ts
```

---

### 任务 3：消息通知铃声选择器

**文件：**
- 修改：`src/features/profile/store/use-app-settings-store.ts`
- 修改：`src/features/profile/screens/NotificationSettingsScreen.tsx`
- 修改：`src/i18n/locales/zh.json`
- 修改：`src/i18n/locales/en.json`
- 测试：`test/profile-settings-screen.test.js`

- [ ] **步骤 1：增加 store 字段**

增加：

```ts
messageRingtone: 'default' | 'silent' | 'classic'
circleRingtone: 'default' | 'silent' | 'classic'
```

`persist` 的 `merge` 逻辑要补默认值，保证旧 MMKV 数据升级后也有新 key。

- [ ] **步骤 2：写失败测试**

断言 `message-ringtone` 和 `circle-ringtone`：
- 有 `onPress`
- 有 `valueText`
- 使用 `OptionPickerSheet`
- 更新 `useAppSettingsStore`

- [ ] **步骤 3：实现选择器**

使用现有 `OptionPickerSheet`。除非产品要求预览，否则不要在本任务里接真实音频播放。

- [ ] **步骤 4：验证**

运行：

```bash
node --test test/profile-settings-screen.test.js
npx tsc --noEmit
npx eslint src/features/profile/store/use-app-settings-store.ts src/features/profile/screens/NotificationSettingsScreen.tsx
```

---

### 任务 4：界面与显示枚举设置

**文件：**
- 修改：`src/features/profile/store/use-app-settings-store.ts`
- 修改：`src/features/profile/screens/AppearanceSettingsScreen.tsx`
- 可能复用/修改：`src/features/chat/screens/ChatBackgroundScreen.tsx`
- 修改：`src/i18n/locales/zh.json`
- 修改：`src/i18n/locales/en.json`
- 测试：`test/profile-settings-screen.test.js`
- 可能新增/修改测试：`test/chat-preferences-store.test.js`

- [ ] **步骤 1：定义本地枚举设置**

增加持久化字段：

```ts
displayMode: 'auto' | 'compact' | 'comfortable'
fontSize: 'small' | 'standard' | 'large'
pinnedFoldCount: 'unlimited' | '3' | '5' | '10'
```

- [ ] **步骤 2：决定全局聊天背景行为**

推荐方案：
- `global-chat-background` 路由到独立全局聊天背景页，或扩展现有聊天背景页并显式传入 global mode。
- 如果现有 chat preferences store 已经管理全局聊天背景，优先复用它，不再新建状态源。

- [ ] **步骤 3：写失败测试**

断言每一行都打开选择器或路由，不再只依赖静态 `valueKey`。

- [ ] **步骤 4：实现选择器和路由**

用 `OptionPickerSheet` 实现：
- `displayMode`
- `fontSize`
- `pinnedFoldCount`

`global-chat-background` 路由到专门页面，不要把复杂选择器塞进 `AppearanceSettingsScreen`。

- [ ] **步骤 5：验证**

运行：

```bash
node --test test/profile-settings-screen.test.js test/chat-preferences-store.test.js
npx tsc --noEmit
npx eslint src/features/profile/store/use-app-settings-store.ts src/features/profile/screens/AppearanceSettingsScreen.tsx
```

---

### 任务 5：隐私设置与黑名单

**文件：**
- 修改：`src/features/profile/store/use-app-settings-store.ts`
- 修改：`src/features/profile/screens/PrivacySettingsScreen.tsx`
- 新建：`src/features/profile/screens/BlacklistSettingsScreen.tsx`
- 新建：`app/(tabs)/profile/settings-blacklist.tsx`
- 修改：`src/services/api/friends.ts`
- 修改：`src/i18n/locales/zh.json`
- 修改：`src/i18n/locales/en.json`
- 测试：`test/profile-settings-screen.test.js`
- 测试：`test/friend-settings-screen.test.js`

- [ ] **步骤 1：确认黑名单列表 endpoint**

已有 helper：
- `addFriendToBlacklist(friendUserId)`
- `removeFriendFromBlacklist(friendUserId)`

缺少 helper：
- `fetchBlockedFriends()`，需要确认后端 endpoint，例如 `GET /friend/block`。

- [ ] **步骤 2：增加本地枚举设置**

增加持久化字段：

```ts
selfDestructDays: 'off' | '1' | '2' | '7'
momentsVisibility: 'all' | 'friends' | 'private'
addMeMethods: string[] // 或拆成 account/qr/group/card 等显式 boolean
callPermission: 'friends' | 'nobody' | 'everyone'
groupInvitePermission: 'friends' | 'confirm' | 'nobody'
```

- [ ] **步骤 3：写失败测试**

断言隐私行要么路由到黑名单页，要么打开 store-backed 选择器。

- [ ] **步骤 4：实现黑名单页**

页面能力：
- 加载已拉黑用户。
- 展示空状态、加载态、错误态。
- 支持确认后移除黑名单。
- 移除成功后刷新列表。

- [ ] **步骤 5：实现隐私选择器**

单选项用 `OptionPickerSheet`。`addMeMethods` 是多选，建议做独立页面或多 switch 弹层。

- [ ] **步骤 6：验证**

运行：

```bash
node --test test/profile-settings-screen.test.js test/friend-settings-screen.test.js
npx tsc --noEmit
npx eslint src/features/profile/store/use-app-settings-store.ts src/features/profile/screens/PrivacySettingsScreen.tsx src/features/profile/screens/BlacklistSettingsScreen.tsx src/services/api/friends.ts
```

---

### 任务 6：关于我们与法律页

**文件：**
- 修改：`src/features/profile/screens/AboutSettingsScreen.tsx`
- 新建：`src/features/profile/screens/LegalDocumentScreen.tsx`
- 新建：`app/(tabs)/profile/legal/[document].tsx`
- 修改：`src/i18n/locales/zh.json`
- 修改：`src/i18n/locales/en.json`
- 测试：`test/profile-settings-screen.test.js`

- [ ] **步骤 1：把非动作行改成非可点击**

`version` 设置为：

```ts
type: 'info'
```

- [ ] **步骤 2：决定法律内容来源**

三选一：
- 本地静态文案，放在 i18n/resources。
- 远程 URL，用 `Linking.openURL` 打开。
- 后端 CMS endpoint。

- [ ] **步骤 3：写失败测试**

断言：
- `user-agreement` 有路由或外链打开动作。
- `privacy-policy` 有路由或外链打开动作。
- `version` 是 info-only。

- [ ] **步骤 4：实现法律页**

如果选择本地静态页，则用共享 `LegalDocumentScreen`，通过 `document` route param 区分用户协议和隐私政策，并使用本地化文案。

- [ ] **步骤 5：决定更新检查行为**

Expo app 不要假装做应用商店更新检查。可接受 MVP：
- `check-updates` 改为纯信息行，显示当前版本/已是最新。
- 或者如果已配置应用商店 URL，就打开对应商店页。

- [ ] **步骤 6：验证**

运行：

```bash
node --test test/profile-settings-screen.test.js
npx tsc --noEmit
npx eslint src/features/profile/screens/AboutSettingsScreen.tsx src/features/profile/screens/LegalDocumentScreen.tsx
```

---

### 任务 7：系统权限行语义修正

**文件：**
- 修改：`src/features/profile/screens/SystemPermissionsScreen.tsx`
- 测试：`test/profile-settings-screen.test.js`

- [ ] **步骤 1：写失败测试**

断言每个权限行都有：

```ts
type: 'info' as const
```

并且只有底部按钮调用 `Linking.openSettings()`。

- [ ] **步骤 2：实现 info 行**

给以下行加 `type: 'info'`：
- location
- storage
- microphone
- camera
- photo-library
- notifications
- bluetooth

- [ ] **步骤 3：验证**

运行：

```bash
node --test test/profile-settings-screen.test.js
npx tsc --noEmit
npx eslint src/features/profile/screens/SystemPermissionsScreen.tsx
```

---

### 任务 8：最终占位防回归门禁

**文件：**
- 修改：`test/profile-settings-screen.test.js`

- [ ] **步骤 1：增加最终 no-placeholder 回归测试**

断言以下设置 screen 不再包含没有处理动作的可点击占位行：
- `AccountSecuritySettingsScreen.tsx`
- `NotificationSettingsScreen.tsx`
- `AppearanceSettingsScreen.tsx`
- `PrivacySettingsScreen.tsx`
- `SystemPermissionsScreen.tsx`
- `AboutSettingsScreen.tsx`

判定规则：
- link row 必须有 `onPress`
- info row 必须有 `type: 'info'`
- toggle row 必须有受控 `value`

- [ ] **步骤 2：运行相关测试**

运行：

```bash
node --test test/profile-settings-screen.test.js
node --test test/*.test.js
npx tsc --noEmit
```

- [ ] **步骤 3：运行 lint**

运行：

```bash
npx eslint <changed files>
```

注意：当前全仓 `npm run lint` 仍有既有错误：
- `src/features/discover/screens/CreateCircleScreen.tsx`
- `src/features/discover/screens/InvitationVerificationScreen.tsx`

在这两个无关错误修好前，不要宣称全仓 lint 通过。

---

## 推荐实现顺序

1. 先做任务 7：系统权限行语义修正，成本低、风险低。
2. 再做任务 6：关于我们/法律页；但更新检查如果产品策略未定，先做 info-only。
3. 再做任务 3 和任务 4：纯本地持久化设置，不依赖后端。
4. 黑名单等后端列表 endpoint 确认后做任务 5。
5. 账号安全任务 2 放最后，因为后端/产品契约风险最大。
6. 最后做任务 8，作为防回归门禁。

## 待确认问题

- 设备列表/撤销、微信绑定/解绑、注销账号、黑名单列表的官方后端 endpoint 分别是什么？
- 铃声设置只需要持久化标签，还是要预览/播放真实声音资源？
- 字体大小现在是否要影响全局 typography token，还是先只持久化偏好？
- 全局聊天背景应复用现有聊天背景页，还是做一个 global-only 页面？
- 用户协议/隐私政策是本地静态文案、远程 URL，还是 CMS 后端返回？
- 更新检查是否纳入 Expo/应用商店集成；如果不纳入，是否接受它作为 info-only 行？
