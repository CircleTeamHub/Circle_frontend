/**
 * chat-core 新增依赖的无副作用替身:增量同步协调器(./sync)、待发媒体持久副本
 * (./pending-media)、通知栏收起(./chat-notifications)、token 刷新
 * (@/services/api/client)、JWT 过期判定、冷启动预载名单(./eager-hydration)
 * 与本地删除墓碑(./deleted-messages)。
 *
 * 各测试自带的 require 替身遇到不认识的模块会直接抛「unexpected require」。
 * withChatCoreStubs 包在外面:测试显式提供了的模块用测试自己的(便于断言调用),
 * 没提供(抛错)时回落到这里的默认桩。与 observability-stubs 同一套约定。
 */
function makeChatCoreStubs() {
  return {
    // 已处理失败的上报(chat-core/api 翻页失败时用);观测层另有专门的桩,这里只兜底。
    '@/observability/report-failure': { reportHandledFailure: () => {} },
    // 列表翻页收集:纯函数,用真实实现(chat-core/api 拉会话快照时用它按游标翻到底)。
    get '@/services/api/pagination'() {
      return require('./load-ts-module').loadTsModule('src/services/api/pagination.ts');
    },
    // 会话快照的结构共享:纯函数,用真实实现(store 靠它沿用没变的会话对象)。
    get '@/utils/structural-sharing'() {
      return require('./load-ts-module').loadTsModule('src/utils/structural-sharing.ts');
    },
    // 重连对账补报「已送达」的判定:纯函数,用真实实现。
    get './delivered-catch-up'() {
      return require('./load-ts-module').loadTsModule('src/chat-core/delivered-catch-up.ts');
    },
    // 群写请求记号:纯函数,用真实实现(群操作成功后让群页面回来时重拉)。
    get '@/services/api/group-writes'() {
      return require('./load-ts-module').loadTsModule('src/services/api/group-writes.ts');
    },
    // 冷启动预载名单:纯函数,用真实实现。
    get './eager-hydration'() {
      return require('./load-ts-module').loadTsModule('src/chat-core/eager-hydration.ts');
    },
    './deleted-messages': {
      isMessageDeletedLocally: () => false,
      withoutLocallyDeleted: (messages) => messages,
      markMessageDeletedLocally: () => {},
    },
    './chat-notifications': {
      CHAT_NOTIFICATION_CHANNEL_ID: 'chat',
      ensureChatNotificationChannel: async () => {},
      dismissChatNotifications: () => {},
    },
    './pending-media': {
      pendingMediaFileName: () => 'media',
      persistPendingMediaFile: async () => null,
      resolvePendingMediaUri: async () => null,
      deletePendingMedia: async () => {},
      prunePendingMedia: async () => {},
      clearPendingMediaFiles: async () => {},
    },
    './sync': {
      setConversationCacheResetHandler: () => {},
      startChatSync: () => {},
      resetChatSync: () => {},
      syncConversationsFromSnapshot: async () => {},
      noteLiveRevision: () => {},
    },
    '@/services/api/client': {
      isDefinitiveAuthFailure: () => false,
      refreshSessionAccessToken: async () => 'refreshed-token',
    },
    '@/features/notifications/services/push-token-registration': {
      getRegisteredPushToken: () => null,
      subscribeRegisteredPushToken: () => () => {},
    },
    '@/utils/jwt-expiry': {
      readJwtExpiryMs: () => null,
      isJwtExpired: () => false,
    },
  };
}

function withChatCoreStubs(requireImpl) {
  const stubs = makeChatCoreStubs();
  return (request) => {
    if (!Object.prototype.hasOwnProperty.call(stubs, request)) {
      return requireImpl(request);
    }
    try {
      return requireImpl(request);
    } catch {
      return stubs[request];
    }
  };
}

module.exports = { makeChatCoreStubs, withChatCoreStubs };
