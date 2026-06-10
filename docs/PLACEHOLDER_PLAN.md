# 占位功能改造计划 (Placeholder Implementation Plan)

> 目标：把项目里仍是「占位 / 即将上线」的入口逐个落地为真实功能。
> 本文档列出全部待办项、所属分类、实现方式、依赖与验收标准，作为下一步开发依据。

## 背景

历史排查中发现两类「占位」：

1. **误导型占位（已修复）** —— 看起来是真页面、实际不可用。
   - 聊天预览模式 `isPreviewMode`：入口只传 `sourceID`、缺 `conversationID` 时聊天页停在「仅预览」。
   - ✅ 已在 `ChatDetailScreen` 内统一解析会话（`getOrCreateSingleConversation` / `getOrCreateGroupConversation`），所有入口（联系人 / 群聊列表 / 报名管理 / 个人资料 / 圈子详情 / 搜索 / 临时会话等）都会进真实聊天；仅当 IM 未接通时才退化为预览。

2. **诚实型占位（本计划处理）** —— 点击后弹 Alert 告知「即将上线」。背后功能从未实现，需要从零开发。

---

## A 组：纯前端可实现（无需后端）

### A1. 表情面板 (Emoji Picker) — ✅ 已完成
- **位置**：`src/features/chat/screens/ChatDetailScreen.tsx`（emoji 按钮当前弹「即将上线」）
- **现状**：已实现自绘 emoji 网格，`handleEmojiToggle` 可打开/关闭面板，选中后按输入框当前光标位置插入到 `draft`。
- **方案**：接入 emoji 选择面板（评估 `rn-emoji-keyboard` 或自绘网格），选中后插入到 `draft` 当前光标位置（已有 `selection` state）。
- **依赖**：无后端。可能新增一个轻量依赖（走 `npx expo install`）。
- **验收**：单聊/群聊点表情 → 弹面板 → 选表情插入输入框 → 可正常发送。
- **实现依据**：`src/features/chat/components/emoji-picker.tsx`、`src/features/chat/screens/ChatDetailScreen.tsx`。

### A2. 聊天图片背景 (Chat Image Background) — ✅ 已完成
- **位置**：`src/features/chat/screens/ChatBackgroundScreen.tsx:192`（「暂未开放，图片背景稍后提供」）
- **现状**：已接入系统图片选择、presign 上传、会话级背景偏好存储，聊天详情页已按 `imageUri` 渲染背景。
- **方案**：`expo-image-picker` 选图 → 复用上传 presign 流程（`requestUploadPresign` / `uploadLocalFileToPresignedUrl`）→ 存入 `useChatPreferencesStore.backgroundsByConversationID`。`resolveChatBackgroundStyle` 已支持 `imageUri`。
- **依赖**：无新后端（复用现有上传）。
- **验收**：选图后聊天背景生效并持久化；切换会话各自独立。
- **实现依据**：`src/features/chat/screens/ChatBackgroundScreen.tsx`、`src/features/chat/store/use-chat-preferences-store.ts`。

### A3. 选择笔记 (Note Picker @ 发帖) — ✅ 已完成
- **位置**：`src/features/social/screens/CreatePostScreen.tsx:411`（「选择笔记」当前弹「即将上线」）
- **现状**：已新增选择笔记页，发帖表单可展示选中标题，并在提交 `createPlazaPost` 时传入 `noteId`。
- **方案**：新建笔记选择页（复用笔记列表接口，参考 `NotesScreen`）→ 选中回填 `noteId` 与展示标题。后端 `createPlazaPost` 已接受 `noteId`。
- **依赖**：笔记列表接口（已存在）。
- **验收**：发帖可关联一篇笔记，提交后帖子带 `noteId`。
- **实现依据**：`src/features/social/screens/SelectNoteScreen.tsx`、`app/(tabs)/discover/select-note.tsx`、`src/features/social/screens/CreatePostScreen.tsx`。

---

## B 组：需要后端接口配合

### B1. 忘记密码 (Forgot Password) — ⛔ 待后端
- **位置**：`src/features/auth/screens/LoginScreen.tsx:91`
- **现状**：仍弹 Alert「请联系客服」。当前前端 API 仅有登录、注册、刷新 token、改密码、改账号、退出登录，未发现发码/校验/重置密码接口。
- **方案**：需后端提供重置流程（手机/邮箱验证码 → 重置）。前端做验证码页 + 重置页。
- **依赖**：⛔ 后端接口（发码、校验、重置密码）。
- **验收**：完成一次找回密码端到端。

### B2. 笔记：已删除笔记 / 分享 / 二维码 — 🟡 分享/二维码前端已接 managed link，回收站/后端落库待后端
- **位置**：`src/features/notes/screens/NotesScreen.tsx`（多处 stopgap）
- **方案**：
  - 已删除笔记列表：需后端「回收站」查询 + 恢复/彻底删除接口。
  - 分享：前端调用后端创建分享链接，再走系统原生 Share；后续可补 IM 内分享入口。
  - 二维码：二维码只编码后端返回的公开分享 URL，不再编码前端本地 deep link。
- **依赖**：⛔ 回收站接口；⛔ 后端 `POST /note/share-links` 需落库 token、权限、过期/撤销与公开 URL。
- **进度**：
  - 已删除笔记列表：仍待后端「回收站」查询 + 恢复/彻底删除接口。
  - 分享：✅ 前端已接 `createNoteShareLink`，请求 body 包含当前视图的状态、分组、搜索词与 noteIds；成功后用后端返回的 `url` 调系统 Share。
  - 二维码：✅ 已用 `react-native-qrcode-svg` 生成二维码 sheet，支持创建中/失败状态、复制链接和系统分享；二维码内容为后端返回的 `shareLink.url`。
- **验收**：三个入口分别可用。

---

## C 组：原生 SDK / 系统权限

### C1. 音视频通话 (RTC) — ⛔ 需单独立项
- **位置**：`UserProfileScreen.tsx:633`、`ChatDetailScreen` 视频按钮（issue #28）
- **依赖**：⛔ RTC SDK（声网/腾讯 RTC 等）+ 信令后端。
- **备注**：工作量大，需单独立项。

### C2. 语音消息 (Voice Message) — ✅ 基础链路已完成
- **位置**：`ChatDetailScreen.tsx`（mic 按钮）
- **现状**：已开启麦克风权限配置，聊天页 mic 按钮可开始/停止录音，停止后用 OpenIM `createSoundMessageFromFullPath` 发送；历史/新消息可映射为语音气泡，气泡支持播放/暂停。
- **补充**：当前实现走 OpenIM SDK 的本地录音路径发送能力；如需服务端自定义存储策略，再补 presign 上传 + `createSoundMessageByURL`。

### C3. 扫一扫 (QR Scan) — ✅ 已完成
- **位置**：`MessagesScreen.tsx:393`
- **依赖**：相机权限 + 二维码解码（已接 `expo-camera`）+ 扫码结果路由规范。
- **现状**：已接入 `expo-camera`，消息页「扫一扫」进入真实扫码页；支持相机权限处理、QR-only 扫描、已知 Circle IM 路由跳转，未知内容复制到剪贴板。

---

## D 组：有意限制（无需改动）

- **群聊不支持积分转账** —— `ChatDetailScreen.tsx:755`，产品规则，保留。

---

## 建议执行顺序

1. **A 组（A1 → A2 → A3）** —— 已完成。
2. **B 组** —— B2 分享/二维码前端链路已完成；B1 忘记密码、B2 回收站、B2 分享链接后端落库/解析待后端接口就绪后推进。
3. **C 组** —— C2 语音消息、C3 扫一扫已完成基础链路；C1 音视频通话仍需 RTC SDK + 信令后端，单独立项。

## 进度跟踪

| 项 | 分类 | 状态 |
|---|---|---|
| 聊天预览模式 | 误导型 | ✅ 已修复 |
| A1 表情面板 | 前端 | ✅ 已完成 |
| A2 图片背景 | 前端 | ✅ 已完成 |
| A3 选择笔记 | 前端 | ✅ 已完成 |
| B1 忘记密码 | 后端 | ⬜ 待后端 |
| B2 笔记 回收站/分享/二维码 | 混合 | 🟡 分享/二维码前端已完成，回收站/分享后端待补 |
| C1 音视频通话 | 原生 SDK | ⬜ 需立项 |
| C2 语音消息 | 原生 | ✅ 基础链路已完成 |
| C3 扫一扫 | 原生 | ✅ 已完成 |
