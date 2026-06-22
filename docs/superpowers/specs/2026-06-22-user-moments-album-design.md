# 用户朋友圈相册页（仿微信「他的朋友圈」）— 设计文档

- **日期**：2026-06-22
- **分支**：`feat/user-moments-album`（前端 circle-im） + 配套后端分支（circle_be）
- **状态**：已确认方向，待实现

## 1. 目标

从好友资料页（`UserProfileScreen`）的「朋友圈」入口行点进去，进入**该用户的朋友圈相册页**：

- 顶部：全宽封面图（`User.cover`），右下角叠加昵称 + 头像（半压在封面下沿）。
- 下方：该用户的朋友圈动态列表，倒序，下拉刷新 + 上拉分页。

**结构/布局**对标微信「他的朋友圈」相册页；**视觉细节（字号、颜色、间距、圆角）全部使用本 app 的主题 token**（`src/theme/tokens.ts`、`src/theme/colors.ts`），不照搬微信配色。

## 2. 关键决策

1. **数据来源 — 扩展现有 feed 接口**：后端 `GET /trace/feed` 增加可选 `authorId` 查询参数；传入时把 feed 收窄到单个作者，并复用现有可见性/点赞/评论/分页逻辑。不新建接口、不新建 service 方法。前端新增 `fetchUserMoments(userId, params)`。
2. **样式 — 微信布局 + 本 app 主题**：所有颜色取自 `colors`，字号取自 `Typography`，间距取自 `Spacing`（8pt 网格），圆角取自 `Radius`。
3. **封面图已就绪**：`User.cover`（后端 schema 已有）+ 前端 `PublicUser.cover`（`src/services/api/users.ts`）已暴露，header 不需要额外接口。封面为空时用主题占位（纯色/渐变）。
4. **每条动态 = 微信相册样式**：左侧大日期列（日 + 月），右侧内容文字 + 九宫格图片 + 点赞/评论灰块。**不重复显示头像**（整页都是同一人）。区别于 discover feed 里带头像+昵称的 `moment-card`。

## 3. 架构

### 3.1 前端（circle-im）

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `src/features/discover/screens/UserMomentsScreen.tsx` | 相册主屏：`FlatList`，`ListHeaderComponent` = 封面 header，item = 动态行；下拉刷新 + 触底分页；空态/加载/错误态 |
| 新建 | `src/features/discover/components/moment-album-header.tsx` | 封面图 + 昵称 + 头像（叠加布局）；封面空时占位 |
| 新建 | `src/features/discover/components/moment-album-row.tsx` | 单条动态：日期列 + 内容 + 九宫格 + 赞评块 |
| 新建 | `src/features/discover/hooks/use-user-moments.ts` | 拉取/分页/刷新状态（该用户专用，**不复用全局 feed store**，避免状态串台） |
| 改 | `src/services/api/moments.ts` | 新增 `fetchUserMoments(userId, { page, limit })` → `/trace/feed?authorId=…&page=…` |
| 改 | `src/features/user/utils/routes.ts` | 新增 `getUserMomentsHref(scope, id, name?)`，沿用现有 scope→pathname 模式 |
| 新建 | `app/(tabs)/{discover,profile,contacts,messages}/user/[id]/moments.tsx` | 4 个薄路由文件，读取 `id`/`name` 参数渲染 `UserMomentsScreen`（沿用 `remark.tsx`/`tags.tsx` 既有模式） |
| 改 | `src/features/user/screens/UserProfileScreen.tsx` | 给「朋友圈」行（`ProfileActionRow`，目前无 `onPress`）接上跳转 → `getUserMomentsHref(scope, userId, nickname)` |
| 改 | `src/i18n/locales/{en,zh}.json` | 补少量文案（页面标题等，复用现有 `discover.noMoments` 空态） |

**图片九宫格**：现有 `image-grid.tsx` 的 `containerWidth` 写死了 discover 卡片的 padding（`Spacing.lg*2 + Spacing.md*2`）。相册行的左侧日期列占宽不同，需要：把 `ImageGrid` 的可用宽度参数化（新增可选 `containerWidth`/`maxWidth` prop，保持向后兼容），相册行传入自己的宽度。优先复用而非另写一套。

### 3.2 后端（circle_be）

| 操作 | 文件 | 职责 |
|---|---|---|
| 改 | `src/trace/dto/trace.dto.ts` | `TraceFeedQueryDto` 增加可选 `authorId`（`@IsUUID() @IsOptional()`） |
| 改 | `src/trace/trace.service.ts` | `getFeed` 支持 `authorId`：校验该 id 在 `visibleUserIds` 内（即本人或已接受好友且可见），把 `where.fromID` 由 `{ in: visibleUserIds }` 收窄为该 id；保留现有 `OR` 可见性子句。不可见/非好友 → 返回空列表（不报错，避免探测） |
| 改 | `src/trace/__test__/trace.service.spec.ts` | 新增用例：①传 authorId 只返回该用户动态 ②对非好友/不可见用户返回空 ③分页正确 |

## 4. 数据流

```
UserProfileScreen「朋友圈」行 onPress
  → router.push(getUserMomentsHref(scope, userId, nickname))
  → app/(tabs)/<scope>/user/[id]/moments.tsx
  → <UserMomentsScreen userId name scope />
       ├─ useUserMoments(userId)  →  fetchUserMoments(userId, {page,limit})
       │                              →  GET /trace/feed?authorId=userId&page=…&limit=…
       │                              →  TraceService.getFeed(viewerId, { authorId, page, limit })
       ├─ ListHeaderComponent: <MomentAlbumHeader cover nickname avatarUrl />
       │     （cover/avatar 来自路由参数或 fetchUserProfile(userId) 兜底）
       └─ renderItem: <MomentAlbumRow post />  →  点击进入现有 MomentDetailScreen
```

封面/头像/昵称来源：`name` 走导航参数（首屏标题零等待），头像与封面图由 `UserMomentsScreen` 内 `fetchUserProfile(userId)` 拉取（避免把图片 URL 塞进路由参数）。已有 `name` 时先渲染标题，header 图片随 profile 返回再补上。

## 5. UI 拆解（微信布局 + 本 app token）

**封面 Header**
- 全宽封面图，高约 `260`（用具体常量，列入 tokens 风格）；`expo-image`，`contentFit="cover"`。
- 顶部返回键：半透明白色圆底悬浮（透明导航头覆盖在封面上）。
- 右下角：昵称（白字，加阴影保证浅色封面下可读）+ 圆角方头像（约 `64`，`Radius.md`，白描边），头像底部约一半压出封面下沿。
- 封面为空：用主题色占位块（`colors.surface` 或主题渐变）。

**动态行（`MomentAlbumRow`）**
- 左列：日期。该天首条显示「日（大号）+ 月」；同一天后续条目日期列留空对齐（微信式分组）。颜色 `colors.text` / `colors.textSecondary`。
- 右列：内容文字（`Typography.body`，`colors.text`）→ 九宫格图片 → 点赞/评论灰块（`colors.surface` 底，点赞 `colors.warning` 心形 + 名字，评论列表）。
- 时间相对显示（如「3天前」），`colors.textSecondary`。

**列表行为**：`FlatList` + `RefreshControl`（下拉刷新）+ `onEndReached`（分页）。空态复用 `discover.noMoments`。加载/错误态走主题样式。

## 6. 测试（TDD）

- **前端**（`test/*.test.js`，沿用现有 jest 模式）：
  - `test/user-moments-api.test.js`：`fetchUserMoments` 拼对 URL（`authorId`/分页）。
  - `test/user-moments-hook.test.js`：`useUserMoments` 刷新/分页/去重/错误态。
  - `test/moment-album-row.test.js`：日期分组逻辑（同一天只首条显示日期）、空内容/无图渲染。
  - `test/user-profile-moments-nav.test.js`：「朋友圈」行 onPress 跳对路由。
- **后端**：`trace.service.spec.ts` 三个新用例（见 3.2）。
- 目标覆盖率 ≥ 80%。

## 7. 不做（YAGNI）

- 不做封面图编辑/上传（这是「他人」相册，只读）。
- 不做该页内发动态入口（发动态在现有 `CreateMomentScreen`）。
- 不做点赞/评论的新交互（点进 `MomentDetailScreen` 复用现有逻辑）；行内灰块只读展示。
- 不做视频/链接卡片/位置等微信扩展卡片类型（现有 `MomentPost` 只有 text + images）。
- 不做隐私「仅展示最近三天/三个月」等微信设置项。

## 8. 风险 / 依赖

- 后端 `authorId` 的可见性校验必须严谨：非好友或对方设了不可见 → 返回空，**不能**泄露存在性或内容。
- `image-grid.tsx` 参数化要保持对现有 discover 卡片向后兼容（默认值 = 现有行为）。
- 前后端需各自分支，联调时前端可先指向本地后端；后端未合并前，前端 `fetchUserMoments` 已能对接（同一 `/trace/feed`）。
