# 圈子帖子聊天卡片（Plaza Post Chat Card）— 设计文档

**日期**: 2026-07-10
**分支基线**: `feat/plaza-post-multiselect`（前端 circle-im）
**状态**: 已与用户确认设计，待细化实现计划

---

## 1. 目标

1. 把一条**圈子广场帖子（CirclePost）**在聊天里渲染成一张**卡片**（而不是纯文本/链接）。
2. **通用分享入口**：用户可以把圈子帖子分享到任意单聊/群聊，聊天界面把帖子包装成卡片样式。
3. **报名 → 聊天自动流程**：作者从「报名管理」点开某个报名者的聊天时，自动把**该帖子的卡片**作为待发送引用挂在输入框上方，并预填一句开场白「你报名了我发起的活动，开始聊天吧」。用户可编辑/清空文字、可撤掉卡片。
   - 价值：对方一眼知道这次聊天是从**哪个活动的报名**来的（尤其当对方报名了作者的多个活动时）。

## 2. 非目标（本版不做，留后续）

- **朋友圈动态（trace/moment）卡片**：本版只做圈子帖子卡片。moment 卡片与其分享入口是下一版。
- 卡片内的富交互（内联报名/点赞）——卡片只做「展示 + 点击跳详情」。

## 3. 交互决策（已确认）

- 报名流程里，卡片是**待发送引用**（贴在输入框上方，可 ✕ 撤掉）+ 输入框**预填可编辑文案**；用户点发送时卡片 + 文字一起发出。用户完全可控。
- 卡片与开场白发出后是**两条独立消息**（先卡片、后文字），不合并成一条——渲染自然、实现简单。

## 4. 复用的现有基建

| 能力 | 现有实现 | 复用方式 |
|---|---|---|
| 自定义卡片消息 | `NOTE_CARD_EXTENSION='note-card-v1'` + `sendNoteCardMessage` (`src/im/client.ts`) | 照抄模式，新增 plaza-post-card |
| 卡片 payload 解析 | `parseNoteCardPayload` + `getMessagePreview` note 分支 + `mapMessageItemToChatMessage` note 分支 (`src/im/mappers.ts`) | 照抄，新增 plaza-post-card 分支 |
| 卡片气泡 | `bubbles/note-card-bubble.tsx`，在 `chat-bubble.tsx` 汇出、`ChatDetailScreen` renderItem 挂载 | 照抄，新增 `PlazaPostCardBubble` |
| 会话选择器（分享目标） | `forward-picker.tsx` + `useMessageForwardStore`（选会话转发一条消息） | 扩展：新增「待分享帖子卡片」pending 载荷 |
| 聊天内待发送引用条 | `ChatDetailScreen` 的 `quoteComposerBar`（回复引用一条消息） | 参照样式，做「待发送卡片」条 |
| 报名者聊天入口 | `PostSignupsScreen` 第 216-235 行：`getOrCreateSingleConversation(signer.userId)` → `getChatDetailHref(...)` | 在跳转前塞 pending 卡片 + 草稿 |

## 5. 详细设计

### 5.1 卡片消息类型（`src/im/client.ts` + `src/types/index.ts` + `src/im/mappers.ts`）

- 新常量 `PLAZA_POST_CARD_EXTENSION = 'plaza-post-card-v1'`。
- payload 类型 `PlazaPostCardData`（放 `src/types/index.ts`）:
  ```ts
  interface PlazaPostCardData {
    postId: string;
    title: string;        // 帖子内容首行/摘要，作卡片标题
    contentPreview: string | null;
    coverUrl: string | null;   // 首图（无图则 null，气泡显示占位）
    circleName: string;   // 主圈子名（circles[0]）
    city: string | null;  // 首个城市
    signupCount: number;
    authorNickname: string;
  }
  ```
- `sendPlazaPostCardMessage(params: { sourceID; sessionType; card: PlazaPostCardData })`：仿 `sendNoteCardMessage`，用 `createCustomMessage` + `extension=PLAZA_POST_CARD_EXTENSION` + `data=JSON.stringify(card)` + `description='[活动] '+title`。单聊/群聊由 sessionType 决定 recvID/groupID（既有发送封装已处理）。
- `mappers.ts`:
  - `parsePlazaPostCardPayload(data)`：校验 `postId`/`title` 为字符串，兜 imageCount/signupCount 等数值。
  - `getMessagePreview` CustomMessage 分支：`ext === PLAZA_POST_CARD_EXTENSION` → `[活动] {title}`。
  - `ChatMessage` 类型联合加 `'plaza-post-card'`；`mapMessageItemToChatMessage` CustomMessage 分支解析出 `plazaPostCard: PlazaPostCardData` 挂到消息上。
- `src/types/index.ts`：`ChatMessage` 增 `plazaPostCard?: PlazaPostCardData`，type 联合加 `'plaza-post-card'`。

### 5.2 卡片气泡 `src/features/chat/components/bubbles/plaza-post-card-bubble.tsx`（新）

- Props: `{ message: ChatMessage; onPress?: (card) => void }`。
- 布局（参照 note-card-bubble）：左首图缩略（`coverUrl`，无图占位）+ 右侧标题（`numberOfLines=2`）+ 副行 `圈子名 · 城市` + 底行 `报名 {signupCount} · {authorNickname}`。
- 点击 → 跳帖子详情路由（plaza post detail，按当前 scope）。
- 在 `chat-bubble.tsx` 汇出；`ChatDetailScreen.renderItem` 加 `case 'plaza-post-card'`（收发两侧都渲染，走 `withMessageActions`）。

### 5.3 通用分享入口

- 触发点：圈子帖子**详情页**加「分享到聊天」动作（图标或菜单项）；（可选）帖子卡片长按菜单也加。
- 机制：点击 → 打开会话选择器（复用 forward-picker 屏），选中会话后发 `plaza-post-card` 消息。
  - 载荷传递：新增 `usePlazaPostShareStore`（或扩展 `useMessageForwardStore` 支持 `kind: 'plaza-post-card'`）。详情页 `setPending(card)` → 打开 picker → picker 选会话后 `sendPlazaPostCardMessage` → 清空。
  - **决策点（写计划时定）**：扩展 forward store vs 新建 share store。倾向新建轻量 `usePlazaPostShareStore`，避免把 `PendingForward`（要求 ChatMessage）撑复杂。

### 5.4 报名 → 聊天自动流程

- 新 store `src/features/chat/store/use-pending-chat-card-store.ts`:
  ```ts
  { pending: { conversationKey: string; card: PlazaPostCardData; draftText: string } | null;
    setPending; consumeFor(conversationKey): {...} | null; clear }
  ```
  `conversationKey` = 目标单聊的 sourceID（signer.userId 的 UUID 形式），用于确保卡片只挂到对的会话。
- `PostSignupsScreen`「找 TA 聊天」handler：跳转前 `setPending({ conversationKey: signer.userId, card: <该帖子卡片>, draftText: t('plaza.signup.chatOpener') })`。
  - 帖子卡片数据来源：PostSignupsScreen 有 postId（路由参数）。需要帖子标题/首图等——若手头 `MyCirclePost`（excerpt/firstImage/circleId/signupCount）够用则直接用；不够则 `getPost(postId)` 拉一次。**写计划时确认字段来源**。
- `ChatDetailScreen`：
  - 获焦时 `consumeFor(sourceID)`；命中则 setState `pendingCard`，并 `setDraft(prev => prev || draftText)`（不覆盖非空草稿）。
  - 渲染：`pendingCard` 存在时，在输入框上方显示「待发送卡片」条（参照 `quoteComposerBar`）：缩略 + 标题 + ✕（清除 `pendingCard`，草稿保留）。
  - 发送逻辑 `handleSubmit`（或文本发送处）：若 `pendingCard` 存在 → 先 `sendPlazaPostCardMessage`，再（草稿非空时）发文字；成功后 `setPendingCard(null)`。

### 5.5 文案 & i18n（zh/en/ja/ko/es 全补）

- `chat.plazaPostCard.preview` = `[活动] {{title}}`
- `plaza.signup.chatOpener` = `你报名了我发起的活动，开始聊天吧`
- `plaza.post.shareToChat` = `分享到聊天`
- 卡片副行/底行如需 label（如「报名 {{count}}」）走既有或新增 key
- 走 i18n 完整性/对齐测试（`test/i18n-*`）

### 5.6 边界与一致性

- 卡片点进已删除/过期帖 → 详情页现有「不存在/已结束」兜底，不额外处理。
- pending 卡片每次进入会话只挂一次（consume 后清空）；不覆盖用户已输入的草稿；用户撤掉卡片后草稿仍在。
- 群聊也支持分享（发送路径按 sessionType）。报名自动流程只针对单聊（作者 ↔ 报名者）。
- 卡片图片/头像 URL 走 `normalizeMediaUrl`（同 note 卡片），避免 localhost dev 地址。

## 6. 涉及文件（预估）

**新增**
- `src/features/chat/components/bubbles/plaza-post-card-bubble.tsx`
- `src/features/chat/store/use-pending-chat-card-store.ts`
- `src/features/chat/store/use-plaza-post-share-store.ts`（若不扩展 forward store）

**改动**
- `src/im/client.ts`（常量 + `sendPlazaPostCardMessage`）
- `src/im/mappers.ts`（解析 + 预览 + map 分支）
- `src/types/index.ts`（`PlazaPostCardData`、`ChatMessage` 扩展）
- `src/features/chat/components/chat-bubble.tsx`（汇出气泡）
- `src/features/chat/screens/ChatDetailScreen.tsx`（renderItem 分支、pending 卡片条、发送逻辑、consume-on-focus）
- `src/features/notifications/screens/PostSignupsScreen.tsx`（跳转前塞 pending 卡片 + 草稿）
- 圈子帖子详情页（分享入口）+ `forward-picker.tsx`（消费 plaza-post-share）
- 5 个 `src/i18n/locales/*.json`

## 7. 测试计划（源读约定，`node --test test/*.test.js`）

- 卡片消息：`plaza-post-card` 有独立 extension 常量；`sendPlazaPostCardMessage` 存在；mappers 有解析 + 预览分支。
- 气泡：`PlazaPostCardBubble` 汇出且在 renderItem 挂载；点击跳帖子详情。
- 报名流程：PostSignupsScreen 跳转前 `setPending`（含 card + `plaza.signup.chatOpener` 草稿）；ChatDetailScreen `consumeFor` + 不覆盖非空草稿 + 发送时先卡片后文字。
- 通用分享：帖子详情有 `plaza.post.shareToChat` 入口 + 走会话选择器。
- i18n：新 key 5 语言齐全（完整性/对齐测试）。
- 全量回归：不新增失败（当前 baseline 10 个历史失败与本功能无关）。

## 8. 待写实现计划时敲定的小决策

1. 通用分享：扩展 `useMessageForwardStore` vs 新建 `usePlazaPostShareStore`（**默认新建**，避免撑复杂 `PendingForward`）。
2. 报名卡片字段来源：**默认优先用手头 `MyCirclePost`（excerpt/firstImage/circleId/signupCount）拼卡片**；缺字段（如作者昵称/城市）时才 `getPost(postId)` 补齐。写计划时核对 `MyCirclePost` 与 `PlazaPostCardData` 的字段差集。
3. 卡片点击的帖子详情路由：按当前 tab scope 镜像（参照 `getChatDetailHref` 的 scope 分发），**默认落到 `messages` scope 的帖子详情路由**。
