/**
 * chat-core 新增依赖的无副作用替身:增量同步协调器(./sync)、待发媒体持久副本
 * (./pending-media)、通知栏收起(./chat-notifications)、token 刷新
 * (@/services/api/client)与 JWT 过期判定。
 *
 * 各测试自带的 require 替身遇到不认识的模块会直接抛「unexpected require」。
 * withChatCoreStubs 包在外面:测试显式提供了的模块用测试自己的(便于断言调用),
 * 没提供(抛错)时回落到这里的默认桩。与 observability-stubs 同一套约定。
 */
function makeChatCoreStubs() {
  return {
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
