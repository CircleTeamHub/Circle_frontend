# 临时聊天 · 访客网页（temp-chat-web）设计文档

- **状态**：设计待评审（Design — pending review）
- **日期**：2026-06-04
- **作者**：circle-im 团队
- **仓库**：新建独立工程 `temp-chat-web`
- **依赖**：circle_be 后端 temp-chat 接口（已实现）、OpenIM Web SDK
- **关联**：[后端 spec](2026-06-04-temp-chat-design.md) · [后端 plan](../plans/2026-06-04-temp-chat-backend.md)

---

## 1. 背景与目标

发起人在 App 里创建临时聊天后拿到一条分享链接。**对方在浏览器打开链接，不下载 App、不注册账号，就能进入同一个房间一起聊天。** 本工程就是这条链接指向的网页。

后端已就绪：建房、访客静默建号、进群、收发、到期销毁的接口都已实现并测试通过。本设计聚焦访客在浏览器看到的界面与交互。

### 目标
1. 打开链接 → 看到房间信息 → 填昵称（可选）→ 一键加入。
2. 进入后能收发**文字 + 图片**，看到**成员列表**与**到期倒计时**。
3. 房间到期 / 被结束 / 满员 / 链接失效时，有清晰的状态页。
4. 刷新页面不掉线、不重复建号。

### 非目标（v1 不做）
- 语音/视频、文件、表情包、消息撤回/编辑、已读回执。
- 访客互加好友、跨房间历史。
- 多语言（仅中文）。
- 桌面端专属布局（移动优先，桌面居中即可）。

---

## 2. 关键决策（已确认）

| 维度 | 决策 |
| --- | --- |
| 视觉基调 | **App 同款深色**（`#1A1B23` 底，主色靛蓝 `#6366F1`） |
| 消息类型 | **文字 + 图片**（图片走 OpenIM Web SDK 内置上传，无需自建上传） |
| 成员展示 | **人数 + 成员列表**（点顶部人数滑出底部弹层） |
| 语言 | **仅中文** |
| 访客身份 | 刷新复用（`sessionStorage` 缓存 imUserId/imToken），不重复建号 |
| 头像 | 访客无真实头像 → **昵称首字 + 确定性配色圆形** |
| 技术栈 | **Vite + React + TypeScript + `@openim/client-sdk`** |
| 部署 | 静态站点（CDN / 对象存储 / Nginx） |

---

## 3. 总体架构

```
浏览器打开  https://<web>/t/<jwt>
        │
        ▼
┌──────────────────────────── temp-chat-web (Vite/React) ───────────────────────────┐
│  路由 /t/:token                                                                     │
│    1. useRoomMeta(token)  ── POST {API}/temp-chat/by-token/:token/meta ──▶ circle_be │
│    2. 落地页：填昵称 → useGuestSession.join()                                         │
│         └ POST {API}/temp-chat/by-token/:token/join ──▶ circle_be                    │
│            ◀── { imUserId, imToken, groupId, wsUrl, apiUrl, displayName }            │
│            └ 写入 sessionStorage（按 token 维度缓存）                                  │
│    3. useOpenIM(creds): SDK login(wsUrl/apiUrl/imUserId/imToken)                     │
│         ├ getAdvancedHistoryMessageList(groupID)  ── 拉历史                           │
│         ├ on(OnRecvNewMessages) ── 实时收                                             │
│         ├ on(OnJoinedGroupDeleted / dismissed) ── 房间销毁 → 结束页                    │
│         └ sendMessage / createTextMessage / createImageMessageByFile ── 发           │
└────────────────────────────────────────────────────────────────────────────────────┘
        │ SDK 直连 OpenIM 网关（wsUrl / apiUrl，公网可达 + CORS）
        ▼
   OpenIM Server（消息收发 + 图片对象存储）
```

要点：
- 网页只跟两方通信：**circle_be**（拿房间元信息 + 换 IM 凭证）和 **OpenIM 网关**（SDK 直连收发）。
- 图片上传由 SDK 内部完成（`createImageMessageByFile`），不经过 circle_be。

---

## 4. 访客旅程与页面状态

单路由 `/t/:token`，按状态渲染不同页面（一个状态机，不是多路由）：

```
                ┌─────────── meta 请求 ───────────┐
                ▼                                  │
 [Loading] ──▶ meta.status / full / token 非法 ──▶ 分支：
   ├─ ACTIVE 且未满 ─▶ [Landing 正常] ──加入──▶ [Chat] ──销毁/到期──▶ [Ended]
   ├─ 已满           ─▶ [Landing 满员]（无法加入）
   ├─ ENDED/EXPIRED  ─▶ [Ended]
   └─ token 非法/过期 ─▶ [Invalid]（链接无效）
```

| 状态 | 页面 | 关键元素 |
| --- | --- | --- |
| Loading | 加载 | 居中 spinner |
| Landing 正常 | 落地页 | 房间名/emoji、`👥N人在聊 · ⏳剩X`、昵称输入（可空）、**加入聊天**、`无需下载/注册`脚注 |
| Landing 满员 | 落地页 | `人数已满（N/50）`、动作禁用 |
| Chat | 聊天页 | 顶栏（标题 + 倒计时 + 人数）、消息列表、输入栏（🖼️ + 文本 + 发送） |
| 成员弹层 | 底部 sheet | `成员·N人`、行=首字头像+昵称，群主标「群主」、自己标「我」 |
| Ended | 结束页 | `聊天已结束 · 链接已失效` |
| Invalid | 失效页 | `链接无效` |

视觉：见 `.superpowers/brainstorm/` 中已确认的 `chat-style.html`(A) / `landing.html` / `member-panel.html`。

---

## 5. 组件与模块拆分（高内聚小文件）

```
temp-chat-web/
├── index.html
├── vite.config.ts
├── src/
│   ├── main.tsx                      # 挂载 + 路由
│   ├── App.tsx                       # /t/:token 状态机分发
│   ├── constants/theme.ts            # 设计 token（颜色/间距/字号）
│   ├── lib/
│   │   ├── api.ts                    # circle_be 调用（meta / join），含错误归类
│   │   ├── openim.ts                 # @openim/client-sdk 封装（init/login/send/listeners/logout）
│   │   ├── guestStorage.ts           # sessionStorage 读写访客凭证（按 token）
│   │   └── avatar.ts                 # 昵称→首字 + 确定性配色
│   ├── hooks/
│   │   ├── useRoomMeta.ts            # 拉 meta + 状态归类
│   │   ├── useGuestSession.ts        # join（或复用缓存）→ 凭证
│   │   ├── useOpenIM.ts              # login + 历史 + 实时 + 销毁监听 + 发送
│   │   └── useCountdown.ts           # expiresAt → 实时倒计时文案
│   ├── features/temp-chat/
│   │   ├── LandingScreen.tsx         # 正常/满员
│   │   ├── ChatScreen.tsx            # 顶栏 + 列表 + 输入栏 组装
│   │   ├── StatusScreen.tsx          # Ended / Invalid / Loading 复用
│   │   └── components/
│   │       ├── ChatHeader.tsx        # 标题 + Countdown + 人数(开成员弹层)
│   │       ├── MessageList.tsx       # FlatList 式虚拟/懒加载，自动滚底
│   │       ├── MessageBubble.tsx     # 文本 / 图片 气泡（自己 vs 他人）
│   │       ├── Composer.tsx          # 文本输入 + 图片选择 + 发送
│   │       ├── MemberSheet.tsx       # 底部成员弹层
│   │       └── Avatar.tsx            # 首字配色圆
│   └── types/index.ts                # Message / Member / RoomMeta / GuestCreds
```

每个文件单一职责：UI 组件不含网络逻辑，网络/SDK 逻辑收在 `lib/` + `hooks/`。遵循团队前端规范（typed props、不 `any`、设计 token、`useCallback`/`useMemo`、列表用虚拟化、逻辑入 hook）。

---

## 6. OpenIM Web SDK 集成

封装在 `lib/openim.ts`（其余代码不直接碰 SDK）：

| 能力 | SDK 调用（以官方 Web SDK 为准，实现时核对版本） |
| --- | --- |
| 初始化/登录 | `getSDK()` → `login({ userID, token, wsAddr, apiAddr, platformID: 5 })` |
| 拉历史 | `getAdvancedHistoryMessageList({ groupID, count, startClientMsgID })` |
| 实时收 | 监听 `OnRecvNewMessages` |
| 发文本 | `createTextMessage(text)` → `sendMessage({ message, groupID })` |
| 发图片 | `createImageMessageByFile(File)` → `sendMessage(...)`（**SDK 内部上传到 OpenIM 对象存储**，无需自建上传） |
| 房间销毁 | 监听群解散/被踢事件（`OnJoinedGroupDeleted` / group dismissed）→ 切结束页 |
| 成员 | `getGroupMemberList({ groupID, ... })`（成员弹层 + 顶部人数） |
| 退出 | 离开页面时 `logout()` 释放连接 |

> SDK 精确方法名/签名随版本不同，实现阶段以 `@openim/client-sdk` 当前版本文档为准；`lib/openim.ts` 这层封装把差异挡在内部。

---

## 7. 会话持久化与刷新

- `join` 成功后把 `{ imUserId, imToken, groupId, wsUrl, apiUrl, displayName }` 以 `sessionStorage[`tc:${token}`]` 缓存。
- 进页面时：先查缓存 → 有则直接用它 SDK login（**不再调 join，不重复建号**）；无则走落地页 join。
- 用 `sessionStorage`（非 localStorage）：关掉标签即清，符合「临时」语义；刷新仍在。
- 若缓存的 token 登录失败（房间已销毁/凭证失效）→ 清缓存 → 按 meta 状态走 Ended/Invalid。

---

## 8. 倒计时

`useCountdown(expiresAt)` 每秒算 `expiresAt - now`：
- `> 1天`：`剩 N天M时`；`< 1天`：`剩 H:MM:SS`；`<= 0`：触发结束页（并停止）。
- 顶栏常驻显示，给访客"临时"的紧迫感。

---

## 9. 错误处理与边界

| 场景 | 表现 |
| --- | --- |
| token 非法/过期 | meta/join 返回 404 → Invalid 页「链接无效」 |
| 房间已结束/过期 | meta 410 或 SDK 销毁事件 → Ended 页 |
| 满员 | meta `full=true` 或 join 409 → Landing 满员/Toast |
| join 超时/503 | 可重试的错误提示（「加入失败，重试」） |
| SDK 登录/初始化失败 | 重试按钮 + 退回；记录控制台错误 |
| 图片过大/格式不支持 | 前端校验（大小/类型）后再交 SDK，给即时反馈 |
| 网络断开 | SDK 自带重连；顶栏显示「连接中…」 |
| 昵称含敏感字符 | 前端 trim+长度限制；渲染走 React 默认转义防 XSS |

---

## 10. 配置与部署

- **env**（构建期注入，Vite `import.meta.env`）：
  - `VITE_API_BASE`：circle_be 基址（meta/join）。
  - 其余（wsUrl/apiUrl）由 join 响应动态返回，不写死。
- **部署**：纯静态产物（`vite build` → 静态站点 + CDN）。需 circle_be 与 OpenIM 网关对该域名开 **CORS**，OpenIM ws 走 **wss + 证书**。
- 分享链接基址 = 本站域名（与后端 `TEMP_CHAT_WEB_BASE` 一致）。

---

## 11. 测试

- **单元（Vitest）**：`avatar.ts`（首字/配色确定性）、`useCountdown`（文案分支/归零触发）、`guestStorage`（缓存命中/失效清除）、`api.ts` 错误归类（404/410/409→状态）。
- **组件（Testing Library）**：状态机分发（meta→各状态页）、Composer（空文本禁发、图片选择回调）、MessageBubble（自己/他人/图片）。
- **SDK 用 mock**：`lib/openim.ts` 注入可替身，hook 测试不连真网。
- E2E（可选 Playwright）：打开 token → 加入 → 发消息（mock 后端 + mock SDK）。

---

## 12. 消费的后端接口（契约）

| 调用 | 方法 | 入 | 出 |
| --- | --- | --- | --- |
| 房间元信息 | `POST {API}/temp-chat/by-token/:token/meta` | — | `{ title, memberCount, maxMembers, status, expiresAt, full }` |
| 加入 | `POST {API}/temp-chat/by-token/:token/join` | `{ displayName? }` | `{ imUserId, imToken, groupId, wsUrl, apiUrl, displayName }` |

（发起/结束由 App 端负责，本网页不调用。）

---

## 13. 未决事项与风险

1. **OpenIM Web SDK 版本与 API**：方法名/事件名以实现时的 `@openim/client-sdk` 版本为准；封装层吸收差异。
2. **OpenIM 网关公网可达 + CORS + wss 证书**：部署事项，须与运维确认。
3. **图片对象存储**：依赖 OpenIM 已配置的 OSS（App 已在用，复用即可）；需确认访客 token 有上传权限。
4. **wasm 体积/首屏**：`@openim/client-sdk` wasm 较大 → 懒加载 + loading 态优化；评估移动网络首开时间。
5. **房间销毁事件名**：不同版本群解散回调命名不同，实现时核对（兜底：登录后轮询 meta）。

---

## 14. 实施阶段（建议）

1. 工程脚手架（Vite+React+TS）+ 设计 token + 路由 + 类型。
2. `lib/api.ts` + `useRoomMeta` + 状态机分发 + StatusScreen（Loading/Invalid/Ended）。
3. LandingScreen + `useGuestSession`（join + 缓存）。
4. `lib/openim.ts` 封装 + `useOpenIM`（login/历史/实时/销毁）。
5. ChatScreen：Header+Countdown、MessageList、MessageBubble、Composer（文本）。
6. 图片：Composer 图片选择 + `createImageMessageByFile` + 图片气泡。
7. MemberSheet + 顶部人数联动。
8. 错误/重连/边界打磨 + 测试 + 部署配置。
