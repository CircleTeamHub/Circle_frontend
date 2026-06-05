# 临时聊天（免注册分享链接）实现设计文档

- **状态**：设计待评审（Design — pending review）
- **日期**：2026-06-04
- **作者**：circle-im 团队
- **涉及仓库**：`circle_be`（后端，主要工作量）、新建 `temp-chat-web`（访客 Web 页）、`circle-im`（App 端发起 + 分享）

---

## 1. 背景与目标

发起人在 App 里一键创建一个「临时聊天」，拿到一条分享链接发给任何人。**对方不下载 App、不注册账号**，直接用浏览器打开链接即可进入同一个房间一起聊天。房间是临时的，到期或被发起人结束后自动销毁。

底层复用项目已接入的 OpenIM。OpenIM **本身不提供**「临时群」类型，也**不提供**匿名 / 免注册能力（每个收发消息的人都必须是带 token 的 OpenIM 用户）。因此「临时」与「免注册」是本功能在**业务层**实现的语义：

- **免注册** = 后端用 admin 身份**静默为访客建号**（用户无感）；
- **临时** = 后端维护房间生命周期（有效期、人数上限、到期/手动销毁 + 清理）。

### 目标

1. App 用户创建临时房间，创建时可编辑标题、有效期、人数上限。
2. 生成带签名、可过期的分享链接。
3. 访客通过浏览器打开链接即可聊天，全程无需注册 / 下载。
4. 房间到期或被发起人结束后自动销毁，并清理资源。

### 非目标（Out of scope）

- 访客之间互加好友、留存社交关系。
- 访客的历史会话跨房间留存（访客是一次性身份）。
- 音视频通话、文件/图片之外的富媒体（首版仅文本 + 图片，按现有 IM 能力）。
- 真正的端到端加密 / 匿名网络层。

---

## 2. 关键决策（已与产品确认）

| 维度 | 决策 |
| --- | --- |
| 会话形态 | **多人临时群**：一个链接 → 多人进入同一房间 |
| 加入者身份 | **一律免注册访客**：无论对方有无 App 账号，打开链接都分配一个临时访客号 |
| 销毁时机 | **固定有效期自动销毁** + **发起人可手动提前结束** |
| 消息留存 | **有效期内保留历史**（可回看），房间销毁即清 |
| Web 承载 | **方案 A：独立轻量 Web 页**（纯 TS/React + `@openim/client-sdk` wasm） |
| 默认有效期 | **3 天**（可编辑，范围 30 分钟 ~ 7 天封顶） |
| 默认人数上限 | **50**（可编辑，范围 2 ~ 50，50 为硬顶） |

---

## 3. 总体架构

三个部分，OpenIM 居中只管底层收发消息：

```
┌─────────────────┐        创建/结束          ┌───────────────────────────┐
│  circle-im App  │ ───────────────────────▶ │  circle_be (NestJS)        │
│  发起人          │ ◀─ shareUrl ──────────── │  └ temp-chat 模块           │
│  @openim/        │                          │     ├ TempChatController     │
│  rn-client-sdk   │ ─── 进群/收发(已登录) ──▶ │     ├ TempChatService        │
└─────────────────┘                          │     ├ TempChatCleanupJob     │
                                             │     └ OpenimService(扩展)     │
┌─────────────────┐    打开链接/进房/收发      │            │                  │
│ temp-chat-web    │ ───────────────────────▶ │            │ admin REST       │
│  访客(浏览器)     │ ◀─ imToken/groupID/ws ── │            ▼                  │
│  @openim/        │                          │      ┌──────────────┐         │
│  client-sdk(wasm)│ ───── 进群/收发 ────────────────▶│   OpenIM     │         │
└─────────────────┘         (直连 IM 网关)     │      │   Server     │         │
                                             └──────┴──────────────┴─────────┘
```

1. **circle_be 新增 `temp-chat` 模块**：建房 / 加入 / 结束 + 定时清理。复用现有 `OpenimService`，并给它补 `dismissGroup`、`forceLogout` 两个方法。
2. **OpenIM Server**：底层群（group type 2）+ 消息收发。admin 直接 `invite_user_to_group` 拉访客进群，**不走 joinGroup 审批流**。
3. **temp-chat-web（新建）**：访客在浏览器用 `@openim/client-sdk` 登录 → 进群聊天。发起人在 App 端继续用现有 `@openim/rn-client-sdk`。

> 复用现状：[`circle_be/src/openim/openim.service.ts`](../../../../circle_be/src/openim/openim.service.ts) 已实现 `registerUser` / `getUserToken(platformID=5 Web)` / `createGroup(groupType=2)` / `addGroupMembers` / `removeGroupMember`，本功能 90% 的 IM 调用已就绪。

---

## 4. 数据模型（Prisma）

在 `circle_be/prisma/schema.prisma` 新增两张表。

```prisma
enum TempChatStatus {
  ACTIVE
  ENDED      // 发起人手动结束
  EXPIRED    // 到期自动销毁
}

model TempChat {
  id          String          @id @default(uuid())
  groupId     String          @unique          // OpenIM groupID（无连字符）
  hostUserId  String                           // 发起人 User.id
  title       String          @default("临时聊天")
  status      TempChatStatus  @default(ACTIVE)
  maxMembers  Int             @default(50)
  expiresAt   DateTime                         // 创建时间 + 有效期
  endedAt     DateTime?                        // 实际销毁时间（结束/到期）
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  guests      TempChatGuest[]

  @@index([status, expiresAt])                 // 清理任务扫描用
  @@index([hostUserId])
}

model TempChatGuest {
  id          String    @id @default(uuid())
  tempChatId  String
  imUserId    String    @unique                // OpenIM 访客 userID
  displayName String                           // 「访客 1234」
  createdAt   DateTime  @default(now())
  lastSeenAt  DateTime  @default(now())
  cleanedUp   Boolean   @default(false)        // 清理标记（force_logout 后置 true）

  tempChat    TempChat  @relation(fields: [tempChatId], references: [id], onDelete: Cascade)

  @@index([tempChatId])
}
```

设计要点：

- `groupId` 用无连字符字符串（OpenIM v3.8 校验器拒绝连字符，沿用 `OpenimService.toImUserId` 的处理）。
- `TempChat.status + expiresAt` 建复合索引，清理任务高效扫描「ACTIVE 且已过期」。
- 访客删除走 `cleanedUp` 软标记 + 物理清理，避免硬依赖 OpenIM 用户删除接口（见 §10、§16）。

---

## 5. 核心流程

### 5.1 发起人创建房间

```
App: 填标题/有效期/人数 → POST /temp-chat (Bearer 业务 token)
  └ TempChatService.create():
      1. 校验入参（标题长度、有效期 30m~7d、人数 2~50）
      2. groupId = "tmp" + nanoid(无连字符)
      3. openim.createGroup(groupId, title, hostImId, [hostImId])   // 发起人即群主
      4. prisma.tempChat.create({ ... expiresAt = now + 有效期 })
      5. token = signLinkJWT({ tcId, exp: expiresAt })
      6. return { id, groupId, shareUrl: `${WEB_BASE}/t/${token}`, expiresAt }
```

发起人本人是已登录 App 用户，用真实账号当群主，在 App 内用现有 RN SDK 进群。

### 5.2 访客加入

```
浏览器打开 shareUrl → temp-chat-web 落地页
  → GET  /temp-chat/by-token/:token        // 校验 + 返回房间元信息（标题/人数/是否已满/是否已销毁）
  → 访客填昵称(可选) → POST /temp-chat/by-token/:token/join
      └ TempChatService.join():
          1. 校验 JWT 未过期、房间 status=ACTIVE、未到 expiresAt
          2. 校验当前人数 < maxMembers（加锁/原子计数，防并发超员）
          3. guestImId = "g" + nanoid(无连字符)
          4. openim.registerUser(guestImId, displayName)            // admin 静默建号
          5. openim.addGroupMembers(groupId, [guestImId])           // admin 直接拉进群
          6. imToken = openim.getUserToken(guestImId, 5)            // platformID=5 Web
          7. prisma.tempChatGuest.create({ ... })
          8. return { imUserId: guestImId, imToken, groupId, wsUrl, apiUrl, displayName }
  → web 用 @openim/client-sdk login(imUserId, imToken) → 进群 → 收发消息
```

### 5.3 结束 / 到期销毁

```
手动：App 群主 → POST /temp-chat/:id/end  → service.end(status=ENDED)
自动：TempChatCleanupJob（每分钟）扫 status=ACTIVE 且 expiresAt<=now → service.expire(status=EXPIRED)
两者统一走 service.teardown(tempChat):
  1. openim.dismissGroup(groupId, deleteMember=true)   // 解散群 → 群消息对客户端不再可见（"销毁即清"）
  2. 对每个 guest: openim.forceLogout(imUserId) → 置 cleanedUp=true（best-effort）
  3. tempChat.status = ENDED/EXPIRED, endedAt = now
  4. 广播一条系统消息/或 web 端收到 onGroupDismissed → 提示「聊天已结束」
```

---

## 6. 后端模块设计（NestJS）

新增目录 `circle_be/src/temp-chat/`，遵循现有模块风格（controller + service + dto + module + 测试）：

```
src/temp-chat/
├── temp-chat.module.ts
├── temp-chat.controller.ts        // 路由 + 鉴权 + 限流
├── temp-chat.service.ts           // 业务编排（建房/加入/结束/清理）
├── temp-chat.cleanup.ts           // @Cron 定时任务（销毁到期房）
├── link-token.service.ts          // 分享链接 JWT 签发/校验（单一职责）
├── dto/
│   ├── create-temp-chat.dto.ts    // 标题/有效期/人数 + class-validator 约束
│   └── join-temp-chat.dto.ts      // 访客昵称(可选)
└── __tests__/
    ├── temp-chat.service.spec.ts
    ├── link-token.service.spec.ts
    └── temp-chat.cleanup.spec.ts
```

- `link-token.service.ts` 独立出来，便于单测签发/校验/过期逻辑，不与业务耦合。
- `temp-chat.cleanup.ts` 用 `@nestjs/schedule` 的 `@Cron`（确认项目已用或新增依赖）。

---

## 7. API 详细设计

所有响应沿用项目统一返回结构。**公开端点**（访客用）无业务鉴权，靠 **link JWT + 限流**保护。

### 7.1 `POST /temp-chat` — 创建（需 App 用户鉴权）

请求：
```json
{ "title": "周末爬山", "ttlMinutes": 4320, "maxMembers": 50 }
```
校验（class-validator）：
- `title`：可选，1–30 字符，默认「临时聊天」
- `ttlMinutes`：可选整数，**30 ≤ x ≤ 10080**（7 天），默认 **4320**（3 天）
- `maxMembers`：可选整数，**2 ≤ x ≤ 50**，默认 **50**

响应 `201`：
```json
{
  "id": "uuid",
  "groupId": "tmpAb12...",
  "shareUrl": "https://chat.example.com/t/<jwt>",
  "title": "周末爬山",
  "maxMembers": 50,
  "expiresAt": "2026-06-07T08:00:00Z"
}
```

### 7.2 `GET /temp-chat/by-token/:token` — 落地页元信息（公开）

校验 JWT + 房间状态。响应：
```json
{ "title": "周末爬山", "memberCount": 7, "maxMembers": 50,
  "status": "ACTIVE", "expiresAt": "...", "full": false }
```
错误：`410 Gone`（已销毁/过期）、`404`（token 无效）。

### 7.3 `POST /temp-chat/by-token/:token/join` — 访客加入（公开 + 限流）

请求：`{ "displayName": "小明" }`（可选，缺省随机「访客 1234」）

响应 `200`：
```json
{ "imUserId": "gXyz...", "imToken": "<openim token>",
  "groupId": "tmpAb12...", "wsUrl": "wss://im.example.com/msg_gateway",
  "apiUrl": "https://im.example.com", "displayName": "小明" }
```
错误：`410`（已销毁/过期）、`409 Conflict`（已满员）、`429`（限流）。

### 7.4 `POST /temp-chat/:id/end` — 发起人结束（需鉴权 + 群主校验）

仅 `hostUserId == 当前用户` 可调用。响应 `200 { "status": "ENDED" }`。非群主 `403`。

### 7.5 `GET /temp-chat/mine` — 发起人的临时房间列表（需鉴权，可选）

供 App 端展示「我创建的临时聊天」及其状态/剩余时间。

---

## 8. 分享链接与令牌

- **链接格式**：`${TEMP_CHAT_WEB_BASE}/t/<jwt>`，`jwt` 载荷 `{ tcId, exp }`，`exp` = 房间 `expiresAt`。
- **签名**：HS256，密钥 `TEMP_CHAT_LINK_SECRET`（独立于业务 JWT 密钥）。
- **为什么用 JWT 而非裸 id**：链接自带过期 + 防遍历/伪造 `tcId`；校验无需查库即可先挡掉过期链接。
- **二次校验**：即便 JWT 未过期，`join` 仍以 DB 的 `status` / `expiresAt` 为准（提前结束的房 JWT 可能仍「未过期」）。

---

## 9. OpenIM 服务扩展

在 [`openim.service.ts`](../../../../circle_be/src/openim/openim.service.ts) 新增两个方法（沿用现有 `this.post(path, body, adminToken)` 封装）：

```ts
/** 解散群：群消息对客户端不再可见，等价于「销毁即清」。已核实路径。 */
async dismissGroup(groupID: string): Promise<void> {
  if (!this.enabled) return;
  const adminToken = await this.getAdminToken();
  await this.post('/group/dismiss_group', { groupID, deleteMember: true }, adminToken);
}

/** 强制访客下线（清会话）。⚠️ 路径需在实现时按部署的 OpenIM 版本确认。 */
async forceLogout(userID: string, platformID = 5): Promise<void> {
  if (!this.enabled) return;
  const adminToken = await this.getAdminToken();
  await this.post('/auth/force_logout',
    { userID: OpenimService.toImUserId(userID), platformID }, adminToken);
}
```

| 调用 | OpenIM 路径 | 状态 |
| --- | --- | --- |
| 建群 | `/group/create_group` | ✅ 已用 |
| 拉人进群 | `/group/invite_user_to_group` | ✅ 已用 |
| 建访客号 | `/user/user_register` | ✅ 已用 |
| 签 Web token | `/auth/get_user_token`（platformID=5） | ✅ 已用 |
| 解散群 | `/group/dismiss_group` | ✅ 已核实 |
| 强制下线 | `/auth/force_logout` | ⚠️ 实现时确认 |
| 硬删访客账号 | 版本相关，可能无公开接口 | ⚠️ 见 §16 风险，不强依赖 |

---

## 10. Web 聊天页（方案 A）

**新建独立工程 `temp-chat-web`**（与 App 解耦，打开快、包小）：

- **技术栈**：Vite + React + TypeScript + `@openim/client-sdk`（wasm，浏览器 IM）。
- **页面**：
  - `/t/:token` 落地页：拉 `by-token` 元信息 → 显示房间标题/人数 → 输入昵称 → 「加入聊天」。
  - 加入后单页聊天界面：消息列表 + 输入框 + 在线人数 + 倒计时（到 `expiresAt`）。
- **流程**：`join` 拿到 `{ imUserId, imToken, wsUrl, apiUrl, groupId }` → SDK `login` → `getGroupMessageList` 拉历史 → 监听 `onRecvNewMessage` / `onGroupDismissed`（房间销毁时弹「聊天已结束」并禁用输入）。
- **部署**：静态站点（如 Nginx / 对象存储 + CDN），`TEMP_CHAT_WEB_BASE` 指向它；需开放 OpenIM 网关公网地址 + CORS。
- **不复用 Expo Web 的原因**：`@openim/rn-client-sdk` 不能在浏览器运行，且会把整个 App 拖进来，违背「点链接秒进」。

> 历史消息「有效期内可回看」由 OpenIM 群消息天然支持（`getGroupMessageList`）；销毁时 `dismissGroup` 让消息对客户端不可见。如需服务端硬清，见 §16。

---

## 11. 生命周期与清理

状态机：`ACTIVE → ENDED`（手动）或 `ACTIVE → EXPIRED`（到期），均触发 `teardown`。

- **定时任务** `TempChatCleanupJob`（`@Cron('*/1 * * * *')`，每分钟）：
  - 查 `status=ACTIVE AND expiresAt <= now` → 逐个 `teardown`（限并发，记录失败重试）。
  - `teardown` 幂等：已 `ENDED/EXPIRED` 跳过；`dismissGroup` 失败下轮重试。
- **资源回收**：解散群 + 访客 `forceLogout` + 置 `cleanedUp`。OpenIM 访客账号硬删作为 best-effort（§16）。
- **观测**：teardown 成功/失败计数接入现有 `logExternalCallFailure` / 性能日志。

---

## 12. 配置项与默认值

`circle_be` 经 `ConfigService` 读取（沿用 `.env`）：

| 变量 | 含义 | 默认 |
| --- | --- | --- |
| `TEMP_CHAT_WEB_BASE` | 访客 Web 页基址 | — |
| `TEMP_CHAT_LINK_SECRET` | 分享链接 JWT 签名密钥 | —（必填） |
| `TEMP_CHAT_DEFAULT_TTL_MINUTES` | 默认有效期 | `4320`（3 天） |
| `TEMP_CHAT_MAX_TTL_MINUTES` | 有效期硬顶 | `10080`（7 天） |
| `TEMP_CHAT_MAX_MEMBERS` | 人数硬顶 | `50` |
| `TEMP_CHAT_JOIN_RATELIMIT` | 单 IP/链接 join 限流 | 例：10 次/分 |
| `OPENIM_IM_WS_URL` / `OPENIM_IM_API_URL` | 返给 Web 端的 IM 网关地址 | — |

---

## 13. 安全与防滥用

1. **链接令牌**：HS256 短期签名、自带过期；`join` 以 DB 状态二次校验。
2. **限流**：`join` / `by-token` 按 IP + token 限流（防刷访客号、防灌水）。
3. **人数封顶**：`join` 原子校验 `memberCount < maxMembers`，并发下不超员。
4. **有效期封顶**：`ttlMinutes ≤ 7 天`，防长期占用资源。
5. **访客 ID**：`toImUserId` 去连字符；随机 nanoid，不泄露顺序/数量。
6. **输入校验**：标题、昵称长度与字符校验（防 XSS，Web 端渲染转义）。
7. **群主校验**：`end` 仅 `hostUserId` 本人可调。
8. **Web 端最小权限**：访客 token 仅能进该群、发消息，不暴露 admin 能力。

---

## 14. 错误处理与边界情况

| 场景 | 处理 |
| --- | --- |
| 链接过期 / 房间已销毁 | `410 Gone`，Web 显示「聊天已结束」 |
| 房间满员 | `409 Conflict`，Web 提示「人数已满」 |
| 同一访客刷新页面 | Web 端缓存 `imUserId/imToken`（sessionStorage），优先复用，避免每次刷新建新号 |
| `createGroup` 成功但建房落库失败 | 事务/补偿：落库失败则 `dismissGroup` 回滚，避免 OpenIM 留孤儿群 |
| `join` 中 `addGroupMembers` 失败 | 不写 guest 行，返回 `503`，让前端重试 |
| OpenIM 未配置（`enabled=false`） | 创建接口直接 `503`，明确报错（不静默成功） |
| 清理任务单房失败 | 不阻塞其它房，记录并下轮重试 |

---

## 15. 测试计划

沿用 circle_be 现有 NestJS 测试风格（jest + service 级单测，mock OpenimService/Prisma）。

- **link-token.service.spec**：签发/校验/过期/篡改拒绝。
- **temp-chat.service.spec**：
  - 创建：默认值填充、边界校验（ttl 30~10080、members 2~50）、groupId 无连字符。
  - 加入：满员拒绝、过期拒绝、已结束拒绝、并发不超员、昵称缺省。
  - 结束：仅群主可结束、幂等。
  - teardown：dismiss + forceLogout 调用、状态流转、幂等。
- **temp-chat.cleanup.spec**：只挑到期 ACTIVE、单房失败不影响其它。
- **集成**：`join` 全链路（mock OpenIM HTTP）拿到可用 token 结构。
- 目标覆盖率沿用团队标准。

---

## 16. 未决事项与集成风险

1. **`/auth/force_logout` 路径**：按实际部署的 OpenIM 版本确认；不可用则改用「解散群即移除会话」兜底。
2. **OpenIM 访客账号硬删**：OpenIM v3 公开 REST 对用户删除支持有限。**清理不强依赖硬删** —— 以 `dismissGroup` 为主、`forceLogout` + 软标记为辅。若账号增长需控制，后续可选优化：
   - **访客 ID 池复用**（房间销毁后回收 ID 给后续房间）；或
   - 与运维约定 OpenIM 侧定期批量清理 dormant 访客。
3. **消息硬清**：如合规要求「销毁后服务端也不留消息」，需确认 OpenIM 是否提供群消息清除接口（`/msg/...`）；否则以 `dismissGroup` 让客户端不可见为准。
4. **Web 端 IM 网关可达性**：需公网地址 + CORS + wss 证书，属部署事项。
5. **`temp-chat-web` 部署位置**：独立静态站点的域名/CDN/CI 需另立（不在 circle_be / circle-im 现有流水线内）。

---

## 17. 实施阶段（建议）

1. **后端骨架**：Prisma 迁移 + `temp-chat` 模块 + `link-token` + 创建/结束接口 + 单测。
2. **访客加入链路**：`join` / `by-token` 端点 + OpenimService 扩展（dismiss/forceLogout）+ 限流 + 单测。
3. **清理任务**：`@Cron` teardown + 幂等/重试 + 单测。
4. **Web 页**：`temp-chat-web` 工程 + 落地/聊天页 + `@openim/client-sdk` 接入。
5. **App 端**：发起人「创建临时聊天」表单（标题/有效期/人数）+ 分享 + 「我的临时聊天」列表。
6. **联调与安全**：限流、CORS、网关、回滚补偿、观测日志。

---

## 18. 关联文件清单

**新增**
- `circle_be/prisma/schema.prisma`（+2 model、+1 enum、迁移）
- `circle_be/src/temp-chat/*`（module/controller/service/cleanup/link-token/dto/__tests__）
- `temp-chat-web/*`（新工程）
- App 端：发起 + 分享 + 列表 UI（circle-im）

**改动**
- `circle_be/src/openim/openim.service.ts`（+`dismissGroup`、+`forceLogout`）
- `circle_be/src/app.module.ts`（注册 `TempChatModule`、`ScheduleModule`）
- `.env` / 配置（§12 变量）
