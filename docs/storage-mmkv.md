# 本地持久化存储：MMKV

> 适用范围：circle-im（Expo / React Native）客户端
> 相关代码：[`src/storage/index.ts`](../src/storage/index.ts)、[`src/storage/encrypted-init.ts`](../src/storage/encrypted-init.ts)、[`src/storage/secure-auth-storage.ts`](../src/storage/secure-auth-storage.ts)
> 依赖版本：`react-native-mmkv@^4.3.1`、`zustand@^5.0.12`、`expo-secure-store`

## 1. MMKV 是什么

MMKV 是微信开源的**键值对（key-value）本地存储库**，底层用 mmap + protobuf 实现，被各大 App 大规模验证过。它解决的是 React Native 里「在设备本地存一点数据、下次启动还能读到」的需求 —— 例如用户偏好、主题、语言、会话分组这类客户端状态。

它**不是**数据库，不适合存大量结构化记录或做复杂查询；它就是一个又快又可靠的「持久化字典」。

> **敏感凭据不放 MMKV**：accessToken / refreshToken / imToken 存在系统 Keychain / Keystore（`expo-secure-store`）里，见第 4.1 节的 `secureAuthStorage`。MMKV 里只放非敏感的缓存与偏好 —— 且整库已加密（见第 4 节）。

## 2. 为什么用它，而不是 AsyncStorage

RN 社区默认的 `@react-native-async-storage/async-storage` 有两个痛点，MMKV 正好都补上：

| 维度 | AsyncStorage | MMKV |
| --- | --- | --- |
| 读写方式 | **异步**（返回 Promise），每次读都要 `await` | **同步**，直接拿到值 |
| 速度 | 慢（走 Bridge / SQLite） | 约 **30× 更快**（mmap，内存映射） |
| 启动期可用性 | 启动时每读一个偏好都要 await | 初始化完成后全程同步读 |
| 体积 | 较大 | 轻量 |

对本项目最关键的是**同步**这一点：语言、主题等偏好在首屏渲染前就要拿到，同步读省去了一轮轮 await。zustand 的 `persist` 中间件也因此能在初始化完成后同步补水。

> 历史背景：本项目最初用的是 AsyncStorage，在 `91ba38a perf: migrate persistence from AsyncStorage to MMKV` 这次提交中整体切到了 MMKV。AsyncStorage 现在只保留用于**一次性迁移老数据**（见第 6 节），不再写入新数据。

## 3. 项目里的封装

所有 MMKV 用法都收口在 [`src/storage/index.ts`](../src/storage/index.ts)，对外暴露的核心是三样东西：

```ts
// 1) 同步「壳」：转发到加密 MMKV 实例（id: 'circle-im'）；
//    初始化完成前读返回 undefined、写为 no-op（dev 下会告警）
export const storage = { getString, set, remove, ... };

// 2) 给 zustand persist 用的 StateStorage 适配器
//    初始化完成后同步直读；尚未完成时退化为异步（等 initEncryptedStorage 再读）
export const mmkvJsonStorage: StateStorage = { getItem, setItem, removeItem };

// 3) AsyncStorage → MMKV 的一次性迁移函数（幂等）
export function migrateFromAsyncStorage(): Promise<void> { /* ... */ }
```

约定：**业务代码不直接 `import 'react-native-mmkv'`**，一律从 `@/storage` 引入 `storage` 或 `mmkvJsonStorage`。收口的价值在加密改造时已经兑现过一次：换底层实例不动任何业务代码。

## 4. 整库加密与启动时序

[`src/storage/encrypted-init.ts`](../src/storage/encrypted-init.ts) 让 MMKV 整库 AES 加密，密钥不落明文：

- **密钥**：32 字节随机数（hex），存系统 Keychain / Keystore（`expo-secure-store`，key 为 `circle-im-mmkv-encryption-key`），首次启动生成。
- **就地迁移**：首次带密钥启动时，旧明文库原样打开后 `recrypt(key)` 就地加密，数据零丢失；`encryptionKey` 是 `react-native-mmkv` 的纯运行时参数，**不需要 native 重建**。
- **密钥在库坏**（典型：iOS 卸载重装后 Keychain 幸存而库损坏/错配）：视为不可恢复缓存，清库重建 —— 内容都能从服务端重新同步，登录态在 SecureStore 不受影响。

**启动时序**：SecureStore 只有异步 API，所以初始化是异步的，而老代码在模块求值期就同步读 `storage`。解法是「同步壳 + 启动门」：

1. [`app/_layout.tsx`](../app/_layout.tsx) 的启动门（闪屏未隐藏）内先 `await initEncryptedStorage()`，再跑 AsyncStorage 迁移，应用内容在这之后才渲染 —— 绝大多数读写发生在初始化之后，走同步直读。
2. 初始化前的同步读只有 i18n 模块求值和主题首读会触达，二者各有「门后重应用」补偿（`rehydrateLanguageFromStorage()`；ThemeProvider 挂载在门后）。

## 5. 都用在了哪些地方

### 5.1 zustand persist 持久化的 store（最主要用途）

多数 store 通过 `storage: createJSONStorage(() => mmkvJsonStorage)` 落盘到 MMKV，每个 store 一个独立 key：

| Store 文件 | MMKV key | version | 持久化内容（partialize） |
| --- | --- | --- | --- |
| [`use-message-groups-store.ts`](../src/features/messages/store/use-message-groups-store.ts) | `circle-im-conversation-groups` | **1** | groups / lastSyncedAt |
| [`use-discover-filter-store.ts`](../src/features/discover/store/use-discover-filter-store.ts) | `circle-im-discover-filter` | 0 | appliedCircleIds / appliedCities |
| [`use-chat-preferences-store.ts`](../src/features/chat/store/use-chat-preferences-store.ts) | `circle-im-chat-preferences` | 0 | backgroundsByConversationID（每个会话的聊天背景） |
| [`use-circle-notification-store.ts`](../src/features/discover/store/use-circle-notification-store.ts) | `circle-im-circle-notification` | **1** | globalEnabled / soundEnabled / offlineEnabled |
| [`use-circle-shortcut-order-store.ts`](../src/features/discover/store/use-circle-shortcut-order-store.ts) | `circle-im-circle-shortcut-order` | 0 | 圈子快捷入口排序 |
| [`use-local-unread-store.ts`](../src/features/messages/store/use-local-unread-store.ts) | `circle-im-local-unread-overrides` | 0 | overrides（本地未读数覆盖） |
| [`use-notification-feedback-store.ts`](../src/features/notifications/store/use-notification-feedback-store.ts) | `circle-im-notification-feedback` | 0 | 通知声音/振动反馈开关 |
| [`use-app-settings-store.ts`](../src/features/profile/store/use-app-settings-store.ts) | `circle-im-app-settings` | 0 | 通用设置开关（推送/隐私/提醒等，整份 state） |

**两个例外走 `secureAuthStorage`**（[`src/storage/secure-auth-storage.ts`](../src/storage/secure-auth-storage.ts)），它是「SecureStore + MMKV」混合适配器 —— token 逐字段写进系统 Keychain / Keystore，非敏感 metadata 才进 MMKV：

| Store 文件 | key | 拆分方式 |
| --- | --- | --- |
| [`src/stores/authStore.ts`](../src/stores/authStore.ts) | `circle-im-auth`（version 1，见 [`authPersist.ts`](../src/stores/authPersist.ts)） | accessToken / refreshToken / imToken → SecureStore；user（经 [`persisted-user.ts`](../src/stores/persisted-user.ts) 剥除 PII）/ isAuthenticated → MMKV |
| [`src/stores/knownAccountsStore.ts`](../src/stores/knownAccountsStore.ts) | `circle-im-known-accounts` | 各账号 token → SecureStore（按 userId 分 entry）；账号列表 metadata → MMKV |

> 落盘格式由 zustand 决定：`{"state": {...}, "version": N}`。读取时按 `version` 比对，不一致且没有 `migrate` 会**丢弃整份数据**（见第 7 节）。

### 5.2 直接 key-value 读写（不走 zustand）

少量「单个值」偏好直接用 `storage` 壳同步读写：

| 位置 | key | 用途 |
| --- | --- | --- |
| [`src/i18n/index.ts`](../src/i18n/index.ts) | `@circle_im_language` | 用户选择的界面语言（模块求值期同步读；门后由 `rehydrateLanguageFromStorage()` 重应用） |
| [`src/theme/provider.tsx`](../src/theme/provider.tsx) | `circle-im-theme-mode` | 浅色 / 深色 / 跟随系统的主题模式（ThemeProvider 在启动门后挂载） |

### 5.3 主动清除（登出 / 重置）

| 位置 | 操作 |
| --- | --- |
| [`src/services/auth/session.ts`](../src/services/auth/session.ts) | 登出时 `secureAuthStorage.removeItem(...)` 清掉登录态（SecureStore 里的 token + MMKV 里的 metadata 一并清） |
| [`use-message-groups-store.ts`](../src/features/messages/store/use-message-groups-store.ts) | 重置会话分组时移除 `circle-im-conversation-groups` |

## 6. AsyncStorage → MMKV 一次性迁移

老用户升级前，数据还在 AsyncStorage 里。[`migrateFromAsyncStorage()`](../src/storage/index.ts) 在 App 启动时（[`app/_layout.tsx`](../app/_layout.tsx)，加密初始化之后）被调用一次，把下列 key 的原始字符串原样拷进 MMKV，再从 AsyncStorage 删除：

```
circle-im-auth、circle-im-chat-preferences、circle-im-discover-filter、
circle-im-circle-notification、circle-im-theme-mode、@circle_im_language
```

要点：

- **幂等**：用 `__migrated_from_async_storage_v1` 标记位 + 内存级 Promise 去重，多次调用只干一次活。
- **失败不写标记**：拷贝/清理只要有一步失败就不打完成标记，下次启动重试，避免「半迁移」被永久封死。
- **故意吞错**：迁移失败也不 rethrow，保证启动流程继续往前走，否则闪屏会无限挂住。

## 7. 版本与迁移的坑（务必看）

zustand persist 的 `version` 一旦从旧值改到新值，**必须同时提供 `migrate` 函数**。否则启动时 zustand 发现「落盘里的 version ≠ 配置里的 version」且没有 `migrate`，会：

1. 打印 `console.error("State loaded from storage couldn't be migrated since no migrate function was provided")`；
2. **直接丢弃整份持久化数据** —— 对 `authStore` 来说就是「已登录用户升级后被静默登出」。

这正是 `authStore` 踩过的真实 bug：早期没有 `version`（默认 0），后来加了 `version: 1` 却没配 `migrate`。修复方式见 [`src/stores/authPersist.ts`](../src/stores/authPersist.ts)（把版本号与迁移逻辑单独抽出、可单测）。

**约定：改任何 persist store 的 `version` 时，同步写 `migrate`。** 如果只是想丢弃老数据，也要用 `migrate` 显式返回干净状态，而不是放任它报错丢数据。

## 8. 小结

- MMKV = 又快又同步的本地键值存储，替代 AsyncStorage 做客户端持久化；整库 AES 加密，密钥在 Keychain / Keystore。
- **auth token 不在 MMKV**：`secureAuthStorage` 把 token 写进 SecureStore，MMKV 只留剥除 PII 的非敏感 metadata。
- 统一封装在 `@/storage`，业务代码不直接碰 `react-native-mmkv`；启动门内 `initEncryptedStorage()` 完成前只有 i18n / 主题两个首读，各有门后补偿。
- 主力场景是 8 个走 MMKV 的 persist store + 2 个走 secureAuthStorage 的混合 store，外加语言、主题两个直读直写偏好。
- 老数据通过 `migrateFromAsyncStorage()` 一次性搬迁。
- 动 persist `version` 必配 `migrate`，否则会丢数据。
