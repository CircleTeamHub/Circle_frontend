# 群设置第二批 设计（2026-09-09）

双仓分支：`feat/group-settings-batch2`（circle-im / circle_be 同名）。范围由用户拍板：
「部分有」的六项 + 两个成员权限开关；黑名单、群昵称、其余策略开关、运营类功能不做。

## 范围

| 项 | 圈子群 | 独立群聊 |
|---|---|---|
| 全体禁言（群主/管理员开关） | ✓（复用 `muteAllAt`） | ✓（发言豁免按 ownerID + 座位管理员） |
| 转让群主 | ✗（圈主转让牵涉会员配额，另立项） | ✓ |
| 群公告 | 已有（Circle.description） | ✓ 新增 `ChatConversation.notice` |
| 群头像 | 已有（圈主可换） | ✓ 新增 `ChatConversation.avatarUrl` |
| 群成员 N/上限 行 → 成员列表 | ✓（上限来自圈子详情） | ✓（上限 200，DTO 下发 `memberLimit`） |
| 进群允许方式：成员邀请 / 二维码 | 成员邀请复用 `Circle.memberCanInvite`；二维码新增 | 两者都新增在会话上 |
| 成员能否查看他人资料 | ✓（默认关，保持现有隐私） | ✓（默认开） |
| 成员能否加好友 | ✓ | ✓ |
| 提升成员上限入口 | ✓（跳现有扩容页） | ✗（固定 200） |

## 数据模型（circle_be）

```prisma
model ChatConversation {
  notice                 String?
  avatarUrl              String?
  memberCanInvite        Boolean @default(true)   // 独立群；圈子群看 Circle.memberCanInvite
  qrJoinEnabled          Boolean @default(true)   // 两种群
  membersCanViewProfiles Boolean @default(true)   // 两种群；圈子群建会话时置 false，迁移回填 false
  membersCanAddFriends   Boolean @default(true)   // 两种群
}
```
迁移 `20260909000000_add_group_settings_batch2`：纯 expand + 一条回填（圈子会话 membersCanViewProfiles=false）。

## 端点（ChatController，群主/管理员）

- `PATCH /chat/conversations/:id/mute-all` `{enabled}`：两种群。豁免：圈子群 OWNER/ADMIN，独立群 群主/管理员。
- `POST /chat/conversations/:id/owner` `{userId}`：独立群群主转让；新群主座位 role/禁言清零，原群主降为普通成员。
- `PATCH /chat/conversations/:id/notice` `{notice}`：独立群。
- `PATCH /chat/conversations/:id/avatar` `{avatarUrl}`：独立群；URL 必须来自本应用存储（与圈子头像同一校验）。
- `PATCH /chat/conversations/:id/policies` `{memberCanInvite?, qrJoinEnabled?, membersCanViewProfiles?, membersCanAddFriends?}`：
  两种群；圈子群的 memberCanInvite 写到 Circle。

强制点：独立群邀请（普通成员且 memberCanInvite=false → `CHAT_GROUP_INVITE_DISABLED`）；扫码入群与签发群码
（qrJoinEnabled=false → `CHAT_GROUP_QR_JOIN_DISABLED`）；加好友请求带 `viaConversationId`（该群禁止且非管理员 →
`FRIEND_GROUP_ADD_FORBIDDEN`）。「查看资料」只在客户端门控（资料接口没有群上下文）。

每个变更 = 系统提示 + 群日志：新 kind `mute-all-changed`、`group-avatar-updated`、`group-policy-changed`
（日志 kind `policy-changed`），复用 `group-notice-updated`、`owner-transferred`。

DTO：`ChatConversationDto` 增 `notice`、`avatarUrl`、`muteAll`、`memberLimit`、`myRole`、`policies`。

## 前端

- 群管理页新增「群设置」段（五个开关）与群主段（转让群主 / 提升成员上限）。
- 群信息页新增群头像行（可换）、群成员行（N/上限 → 成员列表，独立群也能进）、独立群公告；二维码入群关闭时隐藏群码入口；
  打开成员资料按策略门控，并把 `viaConversationID` 透传到资料页。
- 资料页：来自禁止加好友的群且非管理员时隐藏「加好友」；申请页把 `viaConversationId` 带给服务端。
- 聊天页：全体禁言时非管理员输入区锁住并提示；系统提示到达即本地更新会话的 muteAll/策略（不靠 N 次个人房广播）。
