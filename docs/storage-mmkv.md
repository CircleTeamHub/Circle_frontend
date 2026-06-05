# 本地持久化存储：MMKV

> 适用范围：circle-im（Expo / React Native）客户端
> 相关代码：[`src/storage/index.ts`](../src/storage/index.ts)
> 依赖版本：`react-native-mmkv@^4.3.1`、`zustand@^5.0.12`

## 1. MMKV 是什么

MMKV 是微信开源的**键值对（key-value）本地存储库**，底层用 mmap + protobuf 实现，被各大 App 大规模验证过。它解决的是 React Native 里「在设备本地存一点数据、下次启动还能读到」的需求 —— 例如登录 token、用户偏好、主题、语言。

它**不是**数据库，不适合存大量结构化记录或做复杂查询；它就是一个又快又可靠的「持久化字典」。

## 2. 为什么用它，而不是 AsyncStorage

RN 社区默认的 `@react-native-async-storage/async-storage` 有两个痛点，MMKV 正好都补上：

| 维度 | AsyncStorage | MMKV |
| --- | --- | --- |
| 读写方式 | **异步**（返回 Promise），每次读都要 `await` | **同步**，直接拿到值 |
| 速度 | 慢（走 Bridge / SQLite） | 约 **30× 更快**（mmap，内存映射） |
| 启动期可用性 | 启动时读 token 要 await，会让闪屏多挂一会 | 同步读，App 一启动即可拿到登录态 |
| 体积 | 较大 | 轻量 |

对本项目最关键的是**同步**这一点：登录态恢复（session bootstrap）需要在启动时立刻知道「有没有 token」，同步读省去了一轮 await，闪屏到首屏的跳转更干脆。zustand 的 `persist` 中间件也因此能在 `onRehydrateStorage` 里同步完成补水。

> 历史背景：本项目最初用的是 AsyncStorage，在 `91ba38a perf: migrate persistence from AsyncStorage to MMKV` 这次提交中整体切到了 MMKV。AsyncStorage 现在只保留用于**一次性迁移老数据**（见第 5 节），不再写入新数据。

## 3. 项目里的封装

所有 MMKV 用法都收口在 [`src/storage/index.ts`](../src/storage/index.ts)，对外暴露三样东西：

```ts
// 1) 全 App 唯一的 MMKV 实例（id: 'circle-im'）
export const storage = createMMKV({ id: 'circle-im' });

// 2) 给 zustand persist 用的 StateStorage 适配器（同步实现，外壳是 Promise 形状只为满足类型）
export const mmkvJsonStorage: StateStorage = {
  getItem: (key) => storage.getString(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.remove(key),
};

// 3) AsyncStorage → MMKV 的一次性迁移函数（幂等）
export function migrateFromAsyncStorage(): Promise<void> { /* ... */ }
```

约定：**业务代码不直接 `import 'react-native-mmkv'`**，一律从 `@/storage` 引入 `storage` 或 `mmkvJsonStorage`，方便日后统一替换 / 加密 / 埋点。

## 4. 都用在了哪些地方

### 4.1 zustand persist 持久化的 store（最主要用途）

这些 store 通过 `storage: createJSONStorage(() => mmkvJsonStorage)` 把状态落盘到 MMKV。每个 store 用一个独立 key：

| Store 文件 | MMKV key | version | 持久化内容（partialize） |
| --- | --- | --- | --- |
| [`src/stores/authStore.ts`](../src/stores/authStore.ts) | `circle-im-auth` | **1** | accessToken / refreshToken / imToken / user / isAuthenticated |
| [`use-message-groups-store.ts`](../src/features/messages/store/use-message-groups-store.ts) | `circle-im-conversation-groups` | **1** | groups / lastSyncedAt |
| [`use-discover-filter-store.ts`](../src/features/discover/store/use-discover-filter-store.ts) | `circle-im-discover-filter` | 0 | appliedCircleIds / appliedCities |
| [`use-chat-preferences-store.ts`](../src/features/chat/store/use-chat-preferences-store.ts) | `circle-im-chat-preferences` | 0 | backgroundsByConversationID（每个会话的聊天背景） |
| [`use-circle-notification-store.ts`](../src/features/discover/store/use-circle-notification-store.ts) | `circle-im-circle-notification` | 0 | globalEnabled / soundEnabled / offlineEnabled（整份 state） |
| [`use-notes-settings-store.ts`](../src/features/notes/store/use-notes-settings-store.ts) | `circle-im-notes-settings` | 0 | 笔记页各类开关 + lastForceSyncAt（整份 state） |

> 落盘格式由 zustand 决定：`{"state": {...}, "version": N}`。读取时按 `version` 比对，不一致且没有 `migrate` 会**丢弃整份数据**（见第 6 节）。

### 4.2 直接 key-value 读写（不走 zustand）

少量「单个值」偏好直接用 `storage` 单例同步读写：

| 位置 | key | 用途 |
| --- | --- | --- |
| [`src/i18n/index.ts`](../src/i18n/index.ts) | `@circle_im_language` | 用户选择的界面语言（启动时同步读取以决定初始 locale） |
| [`src/theme/provider.tsx`](../src/theme/provider.tsx) | `circle-im-theme-mode` | 浅色 / 深色 / 跟随系统的主题模式 |

### 4.3 主动清除（登出 / 重置）

| 位置 | 操作 |
| --- | --- |
| [`src/services/auth/session.ts`](../src/services/auth/session.ts) | 登出时 `mmkvJsonStorage.removeItem('circle-im-auth')` 清掉登录态 |
| [`use-message-groups-store.ts`](../src/features/messages/store/use-message-groups-store.ts) | 重置会话分组时移除 `circle-im-conversation-groups` |

## 5. AsyncStorage → MMKV 一次性迁移

老用户升级前，数据还在 AsyncStorage 里。[`migrateFromAsyncStorage()`](../src/storage/index.ts) 在 App 启动时（[`app/_layout.tsx`](../app/_layout.tsx)）被调用一次，把下列 key 的原始字符串原样拷进 MMKV，再从 AsyncStorage 删除：

```
circle-im-auth、circle-im-chat-preferences、circle-im-discover-filter、
circle-im-circle-notification、circle-im-theme-mode、@circle_im_language
```

要点：

- **幂等**：用 `__migrated_from_async_storage_v1` 标记位 + 内存级 Promise 去重，多次调用只干一次活。
- **失败不写标记**：拷贝/清理只要有一步失败就不打完成标记，下次启动重试，避免「半迁移」被永久封死。
- **故意吞错**：迁移失败也不 rethrow，保证启动流程继续往前走，否则闪屏会无限挂住。

## 6. 版本与迁移的坑（务必看）

zustand persist 的 `version` 一旦从旧值改到新值，**必须同时提供 `migrate` 函数**。否则启动时 zustand 发现「落盘里的 version ≠ 配置里的 version」且没有 `migrate`，会：

1. 打印 `console.error("State loaded from storage couldn't be migrated since no migrate function was provided")`；
2. **直接丢弃整份持久化数据** —— 对 `authStore` 来说就是「已登录用户升级后被静默登出」。

这正是 `authStore` 踩过的真实 bug：早期没有 `version`（默认 0），后来加了 `version: 1` 却没配 `migrate`。修复方式见 [`src/stores/authPersist.ts`](../src/stores/authPersist.ts)（把版本号与迁移逻辑单独抽出、可单测）。

**约定：改任何 persist store 的 `version` 时，同步写 `migrate`。** 如果只是想丢弃老数据，也要用 `migrate` 显式返回干净状态，而不是放任它报错丢数据。

## 7. 小结

- MMKV = 又快又同步的本地键值存储，替代 AsyncStorage 做客户端持久化。
- 统一封装在 `@/storage`，业务代码不直接碰 `react-native-mmkv`。
- 主力场景是 6 个 zustand persist store（登录态、会话分组、发现页筛选、聊天偏好、圈子通知、笔记设置），外加语言、主题两个直读直写偏好。
- 老数据通过 `migrateFromAsyncStorage()` 一次性搬迁。
- 动 persist `version` 必配 `migrate`，否则会丢数据。
