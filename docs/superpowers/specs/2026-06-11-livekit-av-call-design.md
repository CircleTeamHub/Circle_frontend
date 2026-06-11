# LiveKit 群通话 · Cloud 优先设计

- **状态**：设计草案，待评审
- **日期**：2026-06-11
- **范围**：`circle_be` 后端通话状态 + `circle-im` Expo 客户端接入边界
- **不包含**：本轮不改运行时代码，不部署 LiveKit，不实现语聊房治理能力
- **当前决策**：先用 LiveKit Cloud 做类似腾讯 group call 的多人通话；后续如大陆网络体验不稳，再迁移到自部署 LiveKit
- **参考**：LiveKit 官方 Cloud / Expo / Token / Region / Self-host 文档，Squady WebRTC 服务实现

---

## 1. 背景

当前 C1 音视频通话入口仍是占位：

- `src/features/user/screens/UserProfileScreen.tsx` 的音视频按钮只弹 coming soon；
- `src/features/chat/screens/ChatDetailScreen.tsx` 的 `video-call` 附件项只提示需要 RTC SDK；
- C2 语音消息已完成，但它是 OpenIM 文件消息链路，不等同实时通话。

新的产品约束已经收敛：

1. 需要类似腾讯 TUICallKit 的 **group call**，不是语聊房。
2. 不使用腾讯 RTC。
3. 第一阶段不需要上麦、踢人、主持人、座位、房间公告、麦位管理。
4. 需要先降低复杂度，能尽快验证真实多人语音体验。
5. 未来如果 LiveKit Cloud 在中国大陆体验不稳定，需要能迁移到自部署。

因此本文档替换旧方案：**不再优先复制 Squady 的完整 WebRTC 服务**。Squady 只作为 LiveKit token、room、webhook 的参考实现；Circle 第一阶段直接在 `circle_be` 内实现轻量 CallModule，并连接 LiveKit Cloud。

---

## 2. 术语

### Group call

类似微信群语音/视频通话：

- 从群聊发起；
- 发起人选择一个或多个群成员；
- 被邀请人收到来电；
- 接听的人进入同一个实时通话房间；
- 默认所有接听者都可以说话；
- 用户离开即退出通话。

### Voice room

语聊房/聊天室模型：

- 房间可以长期存在；
- 有 host、speaker、listener、mic seat；
- 需要上麦、下麦、踢人、禁麦、房间管理。

本阶段只做 **group call**，不做 voice room。

---

## 3. 目标

1. 支持群聊内发起多人语音通话，后续可扩展到多人视频。
2. 通话业务状态由 `circle_be` 掌控：发起、邀请、接听、拒绝、离开、结束、超时。
3. App 只调用 `circle_be`，不直接调用 LiveKit 管理 API。
4. `circle_be` 短时签发 LiveKit token，客户端不接触 `LIVEKIT_API_SECRET`。
5. 媒体传输先使用 LiveKit Cloud，降低 RTC 运维成本。
6. 设计上保持 Cloud 到自部署的可迁移性：App 和业务 API 不感知底层是 Cloud 还是自部署。
7. 通话中的实时通知走现有 `/realtime` WebSocket；通话结束记录后续可写入 OpenIM 自定义消息。

---

## 4. 非目标

- 不做腾讯、Agora、Zego 等闭源厂商 SDK。
- 不第一阶段自部署 LiveKit。
- 不直接复制 Squady 完整 WebRTC 服务作为运行依赖。
- 不做语聊房治理：上麦、踢人、禁麦、管理员、房间列表、房间公告。
- 不做系统级来电页：iOS CallKit、PushKit、Android ConnectionService 暂不纳入第一版。
- 不做录制、转写、AI 降噪、质量统计后台、计费后台。
- 不用 OpenIM 承载实时媒体；OpenIM 只用于聊天上下文和通话记录。

---

## 5. 方案选择

### 推荐：LiveKit Cloud + `circle_be` 轻量 CallModule

架构：

```text
circle-im App
  -> circle_be /api/v1/calls/*
  -> circle_be 签发 LiveKit token
  -> App 使用 { livekitUrl, token } 连接 LiveKit Cloud

circle_be
  -> 管通话业务状态、群成员权限、邀请、超时、结束
  -> 持有 LIVEKIT_API_KEY / LIVEKIT_API_SECRET
  -> 接收 LiveKit webhook 更新房间和参与者状态

LiveKit Cloud
  -> 只管实时音视频媒体传输
```

优点：

- 不用腾讯。
- 不需要第一天就处理 UDP/TURN/TLS/多节点/Redis/跨境线路等 RTC 运维问题。
- LiveKit 核心是开源的，未来可以迁到自部署。
- App 只依赖 LiveKit React Native SDK，业务 API 不绑定 Cloud。
- 对“多人 group call，无上麦治理”的范围足够简单。

缺点：

- 中国大陆用户连 LiveKit Cloud 的体验需要实测。
- 付费后有 WebRTC minutes 和下行流量成本。
- 后续自部署仍需要专业网络和运维配置。

当前费用边界（截至 2026-06-11，正式上线前必须重新确认官方 pricing 页）：

| 套餐 | 月费 | WebRTC minutes | 并发连接 | 下行流量 |
| --- | ---: | ---: | ---: | ---: |
| Build | $0/月 | 5,000 included | 100 | 50GB included |
| Ship | $50/月 | 150,000 included, then $0.0005/min | 1,000 | 250GB included, then $0.12/GB |
| Scale | $500/月 | 1,500,000 included, then $0.0004/min | 5,000 | 3TB included, then $0.10/GB |

普通 group call 只需要关注 WebRTC minutes 和下行流量，不涉及 LiveKit Agent、STT、TTS、LLM 的计费。

### 备选：完整复用 Squady WebRTC 服务

把 Squady 的 `/apps/webrtc` 派生为 `circle-webrtc`，作为独立服务运行。

优点：

- 已有 tenant、room、participant、role、webhook、审计日志和 Docker 结构。
- 如果未来做语聊房，这套模型更接近长期房间系统。

缺点：

- 对当前 group call 过重。
- 需要额外服务、额外数据库 schema、额外内部鉴权。
- 仍要接 LiveKit Cloud 或自部署 LiveKit，并不能消除 RTC 运维问题。

结论：当前不采用。保留为后续语聊房或复杂房间治理的参考。

### 不建议：客户端直接拿 LiveKit token endpoint

只做一个 token endpoint，让客户端自己决定谁在通话、谁被邀请、何时结束。

不建议原因：

- 群成员权限、被拉黑、重复来电、忙线、超时、通话记录都会散落在客户端。
- 后续做 push、OpenIM 通话记录、自部署迁移时会返工。
- LiveKit room 不是业务通话状态机，不能替代 `CallSession`。

---

## 6. 第一阶段产品范围

第一阶段主线是 **群语音通话**：

- 入口：群聊详情或群聊聊天页的通话按钮。
- 发起：发起人从群成员中选择被邀请人；后端自动把发起人加入参与者列表。
- 接听：被邀请人收到 realtime 来电，点击接听后获得 LiveKit token 并进入通话页。
- 拒绝：被邀请人可拒绝自己的邀请，不影响其他人。
- 离开：任一参与者可离开；其他人继续通话。
- 结束：当所有已接听参与者离开，或发起人在无人接听前取消，通话进入终态。
- 超时：被邀请人在 45 秒内未接听则标记为 missed。
- 人数：默认最多 10 人，可用 `CALL_MAX_PARTICIPANTS` 配置。

视频通话作为同一模型的后续开关：

- `callType=AUDIO`：token 只允许发布 `microphone`。
- `callType=VIDEO`：token 允许发布 `microphone` + `camera`。
- 第一版 UI 可以只开放 AUDIO，视频按钮继续提示后续开放。

单聊通话可以复用相同模型：

- 单聊就是参与者数量为 2 的 call。
- 如果需要先从单聊入口上线，后端 API 和数据模型不需要重写。

---

## 7. 国内网络策略

LiveKit Cloud 官方是全球分布式服务，默认让用户连最近 edge。按当前官方区域说明，可 pin 的 Asia 区域包括 Japan 和 Singapore，没有中国大陆节点。Region pinning 需要 Scale 或更高套餐。

工程判断：

- 开发、小范围内测：可以直接使用 LiveKit Cloud。
- 中国大陆用户占多数的正式上线：必须做真实设备和真实运营商测试。
- 如果大陆移动/联通/电信表现不稳定，再迁到自部署。

建议的实测矩阵：

| 场景 | 设备/网络 | 目标 |
| --- | --- | --- |
| 2 人语音 | WiFi + 5G | 基础连通和音频稳定 |
| 5 人语音 | 电信/联通/移动混合 | 普通群通话 |
| 10 人语音 | 弱网 + 移动网络 | MVP 上限 |
| 切后台再回来 | iOS / Android | 恢复和重连 |
| 跨地区 | 华东/华南/华北 | 延迟和抖动 |

建议观测指标：

- join 成功率；
- 首次出声耗时；
- RTT / jitter / packet loss；
- 断线重连次数；
- 用户主观评分；
- LiveKit dashboard 中每场 session 的质量指标。

迁移触发条件建议：

- 多运营商环境下频繁出现明显断续；
- 5 人语音平均体验不可接受；
- LiveKit dashboard 显示跨境链路 packet loss 或 jitter 长期偏高；
- 业务增长后 Cloud 成本或数据地域要求不合适。

---

## 8. Cloud 到自部署迁移边界

从 Cloud 迁到自部署时，App 不应改业务代码。

必须保持：

```text
App -> circle_be 创建/加入通话
circle_be -> 返回 { livekitUrl, token, expiresAt }
App -> LiveKit SDK connect(livekitUrl, token)
```

只允许后端和部署层变化：

```bash
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_WEBHOOK_SECRET=...
```

迁移到自部署时需要处理：

- 域名、TLS、WSS；
- UDP 端口开放；
- TURN/STUN；
- 防火墙和安全组；
- LiveKit webhook 对外可达；
- 监控和日志；
- 单节点容量；
- 多节点时的 Redis、负载均衡、区域路由；
- 中国大陆部署时的备案、云厂商线路和合规。

迁移复杂度结论：

- App 侧：低，理想情况下只跟随后端返回新的 `livekitUrl`。
- 后端侧：中，主要是配置和 webhook 验证。
- 运维侧：高，RTC 对网络质量、端口和带宽更敏感。

---

## 9. 后端模块设计

在 `circle_be` 新增 `CallModule`，不新增独立 `circle-webrtc` 服务。

```text
circle_be/src/call/
├── call.module.ts
├── call.controller.ts
├── call.service.ts
├── call-participant.service.ts
├── livekit.service.ts
├── call-timeout.service.ts
├── call-webhook.controller.ts
└── dto/
    └── call.dto.ts
```

职责：

- `CallController`：App HTTP API。
- `CallService`：业务状态机、权限、幂等处理。
- `CallParticipantService`：群通话参与者邀请、接听、离开、missed。
- `LiveKitService`：创建 room、删除 room、签发 token、验证 webhook。
- `CallTimeoutService`：处理来电超时和无人接听结束。
- `CallWebhookController`：接收 LiveKit room/participant 事件。

依赖：

- `PrismaModule`；
- `RealtimeModule`；
- OpenIM group/member 查询能力；
- 后续 OpenIM 自定义消息发送能力。

环境变量：

```bash
LIVEKIT_URL=wss://xxx.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_WEBHOOK_SECRET=...
LIVEKIT_TOKEN_TTL_SECONDS=3600

CALL_RING_TIMEOUT_SECONDS=45
CALL_MAX_PARTICIPANTS=10
CALL_ALLOW_OFFLINE_INVITE=false
CALL_ENABLE_VIDEO=false
```

---

## 10. 数据模型

`circle_be` 持有业务通话状态。LiveKit room 只保存媒体房间状态。

```prisma
enum CallType {
  AUDIO
  VIDEO
}

enum CallStatus {
  RINGING
  ACTIVE
  ENDED
  CANCELED
  MISSED
  FAILED
}

enum CallParticipantStatus {
  INVITED
  JOINED
  LEFT
  REJECTED
  MISSED
}

enum CallEndReason {
  NORMAL
  CANCELED
  ALL_LEFT
  NO_ANSWER
  TIMEOUT
  NETWORK
  ERROR
}

model CallSession {
  id              String      @id @default(uuid())
  conversationID  String
  sessionType     Int
  callType        CallType
  status          CallStatus  @default(RINGING)
  livekitRoomName String      @unique
  initiatorID     String
  startedAt       DateTime?
  endedAt         DateTime?
  expiresAt       DateTime
  endedByID       String?
  endReason       CallEndReason?
  metadata        Json?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  initiator User @relation("callInitiator", fields: [initiatorID], references: [id], onDelete: Cascade)
  participants CallParticipant[]

  @@index([conversationID, createdAt])
  @@index([initiatorID, status])
  @@index([expiresAt, status])
}

model CallParticipant {
  id            String                  @id @default(uuid())
  callID        String
  userID        String
  status        CallParticipantStatus   @default(INVITED)
  invitedAt     DateTime                @default(now())
  joinedAt      DateTime?
  leftAt        DateTime?
  rejectedAt    DateTime?
  missedAt      DateTime?
  lastTokenAt   DateTime?
  createdAt     DateTime                @default(now())
  updatedAt     DateTime                @updatedAt

  call CallSession @relation(fields: [callID], references: [id], onDelete: Cascade)
  user User @relation(fields: [userID], references: [id], onDelete: Cascade)

  @@unique([callID, userID])
  @@index([userID, status])
  @@index([callID, status])
}
```

说明：

- 不引入 host/speaker/listener/seat，避免把 group call 做成语聊房。
- 发起人也是 `CallParticipant`，创建后可直接进入 `JOINED`。
- `livekitRoomName` 由后端生成，不能由客户端传入。
- 后续如果做语聊房，再增加 role、mute、seat，而不是污染第一版模型。

---

## 11. 权限规则

通用规则：

1. 所有接口使用现有 Bearer access token。
2. 后端只信任 JWT 中的 `req.user.userId`，不信任客户端传 caller。
3. LiveKit token identity 使用 Circle user id。
4. LiveKit token metadata 可包含 nickname/avatar，方便客户端渲染。
5. LiveKit API key / secret 只存在服务端。

群通话发起规则：

1. `conversationID` 必须对应 OpenIM 群聊。
2. 发起人必须是群成员。
3. `inviteeIDs` 必须是群成员，并且不能包含发起人。
4. 参与者总数不能超过 `CALL_MAX_PARTICIPANTS`。
5. 被拉黑、禁用、注销用户不能被邀请。
6. 同一用户同一时间默认只能存在一个非终态通话。
7. `CALL_ENABLE_VIDEO=false` 时拒绝 `callType=VIDEO`。

接听规则：

1. 只有 `INVITED` 的被邀请人可以 accept。
2. 超过 `expiresAt` 后 accept 返回 `CALL_EXPIRED`，并把参与者标记为 `MISSED`。
3. 第一个被邀请人接听后，`CallSession` 从 `RINGING` 进入 `ACTIVE`。

离开规则：

1. `JOINED` 的参与者可以 leave。
2. 离开接口幂等，重复调用返回当前状态。
3. 当所有 `JOINED` 参与者都离开时，通话进入 `ENDED`，`endReason=ALL_LEFT`。

取消规则：

1. 发起人在无人接听前可以 cancel。
2. cancel 后所有 `INVITED` 参与者标记为 `MISSED` 或 `LEFT` 以外的终态。
3. 如果已经有人接听，发起人只能 leave，不能强制结束别人的通话。

---

## 12. LiveKit Token 权限

后端为每个参与者单独签发 token。

语音通话：

```ts
{
  roomJoin: true,
  room: livekitRoomName,
  canSubscribe: true,
  canPublish: true,
  canPublishSources: ['microphone']
}
```

视频通话：

```ts
{
  roomJoin: true,
  room: livekitRoomName,
  canSubscribe: true,
  canPublish: true,
  canPublishSources: ['microphone', 'camera']
}
```

安全要求：

- token TTL 默认 1 小时；
- `join-token` 只允许参与者本人获取；
- token 不落库，只记录 `lastTokenAt`；
- 客户端断线重连时重新向 `circle_be` 换 token；
- 结束后的 call 不再签发 token。

---

## 13. HTTP API

所有接口挂在 `/api/v1/calls`。

### 13.1 发起群通话

```http
POST /api/v1/calls/group
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "conversationID": "group_xxx",
  "callType": "AUDIO",
  "inviteeIDs": ["user-b", "user-c", "user-d"]
}
```

返回：

```ts
type CreateGroupCallResponse = {
  call: CallSessionDto;
  selfParticipant: CallParticipantDto;
  livekit: {
    url: string;
    token: string;
    expiresAt: string;
  };
};
```

副作用：

- 创建 `CallSession`；
- 创建所有 `CallParticipant`；
- 创建或预留 LiveKit room name；
- 给发起人返回 token；
- 向被邀请人发送 `call.invite` realtime 事件。

### 13.2 接听

```http
POST /api/v1/calls/:callId/accept
Authorization: Bearer <accessToken>
```

返回：

```ts
type AcceptCallResponse = {
  call: CallSessionDto;
  selfParticipant: CallParticipantDto;
  livekit: {
    url: string;
    token: string;
    expiresAt: string;
  };
};
```

### 13.3 拒绝

```http
POST /api/v1/calls/:callId/reject
Authorization: Bearer <accessToken>
```

只影响当前用户的 participant 状态。其他参与者继续响铃或通话。

### 13.4 离开

```http
POST /api/v1/calls/:callId/leave
Authorization: Bearer <accessToken>

{
  "reason": "NORMAL"
}
```

用于已接听用户退出通话。

### 13.5 取消

```http
POST /api/v1/calls/:callId/cancel
Authorization: Bearer <accessToken>
```

只允许发起人在无人接听前调用。

### 13.6 查询通话

```http
GET /api/v1/calls/:callId
Authorization: Bearer <accessToken>
```

仅参与者可读。用于通知点击、重连、刷新通话状态。

### 13.7 重新获取 LiveKit token

```http
POST /api/v1/calls/:callId/join-token
Authorization: Bearer <accessToken>
```

仅 `INVITED` 或 `JOINED` 的参与者本人可调用。若通话已结束，返回 `CALL_ENDED`。

---

## 14. DTO

```ts
type CallSessionDto = {
  id: string;
  conversationID: string;
  sessionType: 'group' | 'single';
  callType: 'AUDIO' | 'VIDEO';
  status: 'RINGING' | 'ACTIVE' | 'ENDED' | 'CANCELED' | 'MISSED' | 'FAILED';
  livekitRoomName: string;
  initiator: UserLiteDto;
  startedAt: string | null;
  endedAt: string | null;
  expiresAt: string;
  durationSeconds: number | null;
  endReason: string | null;
  participants: CallParticipantDto[];
};

type CallParticipantDto = {
  user: UserLiteDto;
  status: 'INVITED' | 'JOINED' | 'LEFT' | 'REJECTED' | 'MISSED';
  invitedAt: string;
  joinedAt: string | null;
  leftAt: string | null;
};

type UserLiteDto = {
  id: string;
  nickname: string;
  avatarUrl: string | null;
};
```

错误码：

| code | HTTP | 含义 |
| --- | --- | --- |
| `CALL_GROUP_NOT_FOUND` | 404 | 群聊不存在 |
| `CALL_NOT_GROUP_MEMBER` | 403 | 当前用户不是群成员 |
| `CALL_INVITEE_INVALID` | 400 | 被邀请人不是群成员或不可邀请 |
| `CALL_INVITEES_REQUIRED` | 400 | 没有选择被邀请人 |
| `CALL_PARTICIPANT_LIMIT` | 400 | 超过人数上限 |
| `CALL_VIDEO_DISABLED` | 400 | 视频通话开关未启用 |
| `CALL_BUSY` | 409 | 用户已有非终态通话 |
| `CALL_NOT_FOUND` | 404 | 通话不存在或无权访问 |
| `CALL_EXPIRED` | 409 | 来电已过期 |
| `CALL_ENDED` | 409 | 通话已结束 |
| `LIVEKIT_UNAVAILABLE` | 503 | LiveKit 未配置或不可用 |

---

## 15. Realtime 事件

复用现有 `/realtime` WebSocket。客户端已经使用 message-based auth，适合继续沿用。

新增事件类型：

```ts
type CallRealtimeEvent =
  | { type: 'call.invite'; payload: CallInvitePayload }
  | { type: 'call.participant.joined'; payload: CallParticipantPayload }
  | { type: 'call.participant.left'; payload: CallParticipantPayload }
  | { type: 'call.participant.rejected'; payload: CallParticipantPayload }
  | { type: 'call.participant.missed'; payload: CallParticipantPayload }
  | { type: 'call.canceled'; payload: CallStatePayload }
  | { type: 'call.ended'; payload: CallStatePayload };
```

`call.invite` payload：

```ts
type CallInvitePayload = {
  callId: string;
  conversationID: string;
  sessionType: 'group';
  callType: 'AUDIO' | 'VIDEO';
  initiator: UserLiteDto;
  invitees: UserLiteDto[];
  expiresAt: string;
  createdAt: string;
};
```

广播规则：

- `call.invite`：发给被邀请人；
- `call.participant.joined`：发给所有 call participants；
- `call.participant.left`：发给仍在通话内或被邀请的 participants；
- `call.canceled`：发给所有未接听被邀请人；
- `call.ended`：发给所有 participants。

离线策略：

- 第一阶段只保证 App 在线或前台 websocket 已连接时实时响铃。
- 离线 push 和系统来电页后续单独立项。
- OpenIM 自定义通话记录可以在第二阶段补齐离线可见性。

---

## 16. 客户端接入

依赖方向：

- `@livekit/react-native`
- `@livekit/react-native-expo-plugin`
- `@livekit/react-native-webrtc`
- `@config-plugins/react-native-webrtc`
- `livekit-client`

Expo 限制：

- LiveKit React Native 需要原生 WebRTC，不兼容 Expo Go。
- 本项目已有 `expo-dev-client`，应通过 dev build / EAS build 验证。
- 需要在入口调用 `registerGlobals()`。
- `app.json` 需要增加 LiveKit / WebRTC config plugins。

客户端模块建议：

```text
src/features/call/
├── api/callApi.ts
├── hooks/useCallRealtime.ts
├── screens/IncomingCallScreen.tsx
├── screens/GroupCallScreen.tsx
├── components/CallControls.tsx
├── components/ParticipantAudioGrid.tsx
└── state/callStore.ts
```

第一版 UI：

- 群聊通话按钮；
- 群成员选择器；
- 来电弹层；
- 群语音通话页；
- 麦克风开关；
- 扬声器切换；
- 离开按钮；
- 参与者状态列表。

不做：

- 麦位；
- 踢人；
- 主持人控制；
- 录制；
- 复杂动效；
- 系统级来电页。

---

## 17. LiveKit Webhook

后端应接收 LiveKit webhook，但第一版不能完全依赖 webhook 驱动业务状态。

用途：

- 记录 participant joined / left；
- 对账 App 调用 leave 失败的异常状态；
- 房间异常关闭时补偿 `CallSession`；
- 后续接入质量数据或记录。

原则：

- App 主动调用 `/leave` 是业务主路径；
- webhook 是补偿路径；
- webhook 事件必须校验签名；
- webhook 幂等处理。

---

## 18. OpenIM 关系

OpenIM 不参与实时媒体。

后续可写入自定义消息：

- 群通话已取消；
- 群通话未接听；
- 群通话已结束，持续 `xx:xx`；
- 某人发起群语音通话。

第一阶段可以先只做 realtime，不写历史消息。正式上线前建议补齐通话记录，否则用户离线后无法在聊天里看到错过的通话。

---

## 19. Squady 复用边界

Squady 的价值是参考，不是第一阶段运行依赖。

可以借鉴：

- LiveKit token grant 的封装方式；
- room name 生成和 room lifecycle；
- webhook 验签和幂等处理；
- Docker / env 的组织方式；
- 后续自部署时的服务拆分经验。

暂不复制：

- tenant credential 体系；
- room ACL / ban；
- host/speaker/listener role；
- 独立 `circle-webrtc` 数据库；
- participants role 管理 API；
- WebRTC admin API。

如果未来从 group call 升级到 voice room，再重新评估是否派生 Squady WebRTC 服务。

---

## 20. 测试计划

后端单元测试：

- 群成员权限；
- invitee 校验；
- 人数上限；
- busy 状态；
- accept/reject/leave/cancel 幂等；
- token 权限；
- timeout 状态迁移；
- webhook 幂等。

后端集成测试：

- 创建群通话后创建 participants；
- accept 后签发 token；
- 所有人 leave 后 call ended；
- LiveKit unavailable 时返回 `LIVEKIT_UNAVAILABLE`；
- `CALL_ENABLE_VIDEO=false` 时拒绝 video call。

客户端验证：

- iOS dev build 可启动；
- Android dev build 可启动；
- 麦克风权限弹窗正确；
- 两台真机可互通语音；
- 5 人和 10 人场景可进入同一 room；
- 断网/切后台/重连路径不会卡死。

网络实测：

- 中国大陆三大运营商；
- WiFi / 4G / 5G；
- 跨地区；
- 晚高峰；
- LiveKit Cloud dashboard 质量指标记录。

---

## 21. 分阶段实施

### Phase 1：LiveKit Cloud MVP

- 创建 LiveKit Cloud project；
- 配置 `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`；
- `circle_be` 新增 `CallSession` / `CallParticipant`；
- `circle_be` 新增 group call API；
- 接入 realtime call events；
- 客户端接 LiveKit SDK 和群语音 UI；
- 只做在线来电。

### Phase 2：通话记录和离线可见性

- 写 OpenIM 自定义通话记录；
- 离线用户在聊天中看到未接来电；
- 可选接入普通 push；
- 增加通话失败原因展示。

### Phase 3：大陆网络评估

- 用真实国内设备跑 2/5/10 人群语音；
- 汇总 join 成功率、packet loss、jitter、主观体验；
- 决定继续 Cloud、升 Ship/Scale，或准备自部署。

### Phase 4：自部署 LiveKit

- 部署单节点 LiveKit；
- 配置域名、TLS、UDP、TURN；
- `circle_be` 切换 `LIVEKIT_URL` 和 key；
- 对比 Cloud 和自部署质量；
- 如果需要多节点，再引入 Redis 和区域路由。

### Phase 5：扩展能力

- 视频通话；
- 系统级来电页；
- 更完整 push；
- 质量监控后台；
- 如果产品转向语聊房，再单独设计 room/role/seat 模型。

---

## 22. 官方参考

- LiveKit Cloud: https://docs.livekit.io/intro/cloud/
- LiveKit Expo SDK: https://docs.livekit.io/transport/sdk-platforms/expo/
- LiveKit Tokens & Grants: https://docs.livekit.io/frontends/reference/tokens-grants/
- LiveKit Authentication: https://docs.livekit.io/frontends/build/authentication/
- LiveKit Pricing: https://livekit.com/pricing
- LiveKit Region pinning: https://docs.livekit.io/deploy/admin/regions/region-pinning/
- LiveKit Self-hosting: https://docs.livekit.io/transport/self-hosting/
- LiveKit Distributed multi-region: https://docs.livekit.io/transport/self-hosting/distributed/

---

## 23. 当前结论

当前最合适的路线是：

```text
先用 LiveKit Cloud 做 group call MVP
不要第一版复制 Squady 完整 WebRTC 服务
不要把 App 绑定到 Cloud
所有通话业务状态放在 circle_be
国内网络用真实设备验证
体验或成本不合适时，再迁到自部署 LiveKit
```

这个设计比旧方案更贴近当前需求：不做语聊房，不用腾讯，不提前承担自部署 RTC 的复杂度，同时保留后续迁移空间。
