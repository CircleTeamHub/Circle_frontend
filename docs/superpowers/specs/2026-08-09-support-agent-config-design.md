# 客服账号改为管理台可配置

## 目标

把客服账号从 App 的编译期常量，改成后端存储、管理台维护、App 运行时拉取的配置。

换客服人员不再需要重新出包发版；`EXPO_PUBLIC_SUPPORT_*` 整组构建变量随之作废，卡住每日构建和 `v*` 发版的校验门禁一并解除。

## 现状

`src/features/profile/support-categories.ts` 的 `SUPPORT_CATEGORIES` 是模块级常量，`accountIds` 在模块 import 时由 `process.env.EXPO_PUBLIC_SUPPORT_*_ID` 求值。Expo 打包时把 `EXPO_PUBLIC_*` 做字面量替换，所以这些值被烧进 APK：换客服 = 改 GitHub repository variable → 重新出包 → 重新发版 → 用户重装。

会员客服走的是另一条同样写死的路径：`MemberCenterScreen.tsx` 读 `EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID`。

两处都有回退。`config.ts` 的 `SUPPORT_ACCOUNT_ID` 在未配置时回退到 `'imAdmin'` —— OpenIM 时代的系统账号，自研聊天栈里不存在，结果是客服入口正常渲染、一点就被后端以「用户不存在」拒绝。`MemberCenterScreen` 的回退是弹 Alert，属于优雅降级。

这套配置从未被赋值：仓库变量里没有，`.env.example` 里是空的，后端也没有 seed 任何客服账号。

### 连带的 CI 阻塞

`.github/scripts/validate-android-release.js` 的 `validateBuildEnv` 要求这组变量非空且形如 UUID。它被两处调用：

- `daily-android-build.yml` 的 `Validate build environment`
- `android-release.yml` preflight 的 `validateReleaseMetadata`（内联调用 `validateBuildEnv`）

因此每日构建自 2026-08-01 加入以来 8 次全红，从未绿过；打 `v*` tag 发版同样会在 preflight 挂掉。上次成功出包是 2026-07-16。

## 设计

沿用项目里已有的服务端下发链路形态（会员开关）：

| 层 | 会员开关（已有） | 客服账号（本设计） |
|---|---|---|
| 存储 | `MembershipProgramState` 单行表 | `SupportAgent` 表 |
| App 读 | `GET /membership/program` → `membershipProgramStore` | `GET /support/config` → `supportConfigStore` |
| 管理台写 | `POST /admin/memberships/program/enable` | `PUT /admin/support/agents` |
| 审计 | `AdminAuditLog` | 同一张表 |

### 后端 `circle_be`

新表 `SupportAgent`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | 主键 |
| `category` | enum | `recharge` / `issue` / `dispute` / `account` / `membership` |
| `userID` | uuid FK User | 客服账号 |
| `sortOrder` | int | 同类内展示顺序 |
| `enabled` | boolean | 停用而不删除 |
| `createdAt` / `updatedAt` | timestamp | |

`(category, userID)` 唯一，避免同类重复挂同一个人。

用行而不是逗号分隔字符串：「一类多客服」是现有需求（旧环境变量已支持逗号分隔），行结构还能排序和单独停用。

`membership` 作为第五类收编 `EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID`，不再让两套机制并存。

**`GET /support/config`**（需登录）

返回五类各自的客服列表，每个客服带上渲染所需的用户信息（`userID` / `nickname` / `avatarUrl` / `vipLevel`），App 不必再逐个查用户。只返回 `enabled` 且账号 `status = ACTIVE` 的行，按 `sortOrder` 排序。

**`PUT /admin/support/agents`**（管理员）

整表覆盖式写入。写入时校验每个 `userID` 对应的 User 存在且 `status = ACTIVE`，不满足直接 400 —— 把今天「配错了要等用户点击才暴露」提前到配置那一刻。写 `AdminAuditLog`，沿用 `AdminUserAuditService` 的字段转换。

**陌生人开关豁免**

`getOrCreateDirectConversation` 在首次建会话时会过 `canReceiveStrangerMessage`：非好友且对方 `allowStrangerMessages = false` 时抛 403 `StrangerNotAllowed`。该字段默认 `true`，所以新账号能用，但客服本人在 App 里关掉这个开关就会静默切断整条客服通道。

因此在该检查前增加豁免：目标用户是 `enabled` 的 `SupportAgent` 时跳过陌生人判定。做成服务端规则而不是靠约束客服的个人设置，是因为后者无法防止误操作，且失效时没有任何信号。

拉黑判定（`assertNotBlockedBetween`）和账号 `status` 检查保持不变，不豁免。

### App `circle-im`

新增 `src/stores/supportConfigStore.ts`，形态照抄 `membershipProgramStore`：`inFlight` 去重、`runSequence` 防竞态、`retry` 包装、缓存后 `force` 才重取。

`support-categories.ts` 退化为纯静态展示元数据（`id` / `icon` / `labelKey` / `descriptionKey`），`accountIds` 从 store 取。

删除三处回退与兼容代码：

- `config.ts` 的 `SUPPORT_ACCOUNT_ID` 及其 `'imAdmin'` 默认值
- `support-categories.ts` 的 `resolveAccounts` 与 `normalizeSupportAccountId`（32-hex → UUID 兼容）。数据现在写在库里，写入时即为 UUID
- `MemberCenterScreen` 的 `getMembershipSupportUserId`

`MemberCenterScreen` 的联系客服改为读 store 里 `membership` 类的首个客服：有则跳转，无则保留现有的「客服账号暂未配置」Alert 分支。

未配置或拉取失败时，客服中心对应类型显示空态。不再回退到任何默认账号 —— 空态是诚实的失败，`imAdmin` 回退是渲染成功而点击失败。

### 管理台 `circle_admin_web`

新增「客服配置」页：五类分组，每类可按用户搜索添加客服、调整顺序、停用或移除，保存即生效。

### CI

`validate-android-release.js` 删除 `CATEGORY_SUPPORT_ENV`、`validateSupportAccounts`、`validateSupportAccountShapes`，以及 `METADATA_ENV` 里的 `EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID`。两个 workflow 中对应的 `env:` 转发一并删除，`.env.example` 里的六个键删除。

`EXPO_PUBLIC_API_URL` 的必填与 https 校验保留。

## 测试

后端（jest）：`SupportAgent` 覆盖式写入的增删改与顺序、非 ACTIVE 用户被 400 拒绝、审计行落库、`GET /support/config` 过滤停用与非 ACTIVE 账号、陌生人豁免对客服生效且对普通用户不生效、拉黑仍然拦截。

App（node:test 源码断言，遵循本仓约定）：`support-categories.ts` 不再引用 `process.env`、store 的竞态与去重行为、空配置渲染空态而非默认账号。

CI：`validate-android-release.js` 的现有单测同步删除客服相关用例，保留 `EXPO_PUBLIC_API_URL` 与 Sentry DSN 用例。

## 迁移

无数据迁移 —— 这组配置从未被赋值，线上没有既有值需要搬运。建表后由管理台录入首批客服账号。

部署顺序：后端先上（新端点可用），再上 App 与管理台。App 侧删除回退逻辑后若后端尚未部署，客服中心会显示空态而非崩溃。

## 范围之外

- 不做通用「App 运行时配置表」。眼下只有客服这一个需求，通用配置表容易退化成无边界的键值堆。
- 客服账号仍是普通 User，不引入新角色或权限位。是否需要「官方客服」标识、免打扰豁免等，留待有实际需求时再议。
- `UserPrivacySetting.messageSelfDestructDays` 默认 2 天，意味着纠纷与申诉类客服会话的消息两天后消失。这对客服场景大概率不合适，但它是既有行为、影响面超出本设计，单独处理。
