const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function load(rel) {
  const filePath = path.join(process.cwd(), rel);
  const source = read(rel);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => (specifier.startsWith('@/') ? {} : require(specifier)),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('moment detail scrolls to and highlights a target comment', () => {
  const source = read('src/features/discover/screens/MomentDetailScreen.tsx');

  assert.match(source, /targetCommentId/);
  assert.match(source, /highlightedCommentId/);
  assert.match(source, /scrollToIndex/);
  assert.match(source, /targetCommentHighlight/);
});

test('chat detail highlights a searched notification message after scrolling', () => {
  const source = read('src/features/chat/screens/ChatDetailScreen.tsx');

  assert.match(source, /highlightedMessageID/);
  assert.match(source, /setHighlightedMessageID\(searchedMsgID\)/);
  assert.match(source, /targetMessageHighlight/);
  assert.match(source, /message\.id === highlightedMessageID/);
});

test('push notification data resolves to app routes with anchors', () => {
  const { resolvePushNotificationRoute } = load(
    'src/features/notifications/utils/push-notification-route.ts',
  );

  const traceRoute = resolvePushNotificationRoute({
    route: 'trace',
    traceId: 'moment-1',
    replyId: 'comment-9',
  });
  assert.equal(traceRoute.pathname, '/(tabs)/discover/moment/[id]');
  assert.equal(traceRoute.params.id, 'moment-1');
  assert.equal(traceRoute.params.targetCommentId, 'comment-9');

  const chatRoute = resolvePushNotificationRoute({
    route: 'squad',
    squadId: 'group-1',
    messageId: 'client-msg-1',
    title: 'Group',
  });
  assert.equal(chatRoute.pathname, '/(tabs)/messages/chat-detail');
  assert.equal(chatRoute.params.sourceID, 'group-1');
  assert.equal(chatRoute.params.conversationType, 'group');
  assert.equal(chatRoute.params.searchedMsgID, 'client-msg-1');

  const mentionRoute = resolvePushNotificationRoute({
    type: 'MEMBER_MENTION',
    groupID: 'group-2',
    clientMsgID: 'client-msg-2',
    title: 'Mentions',
  });
  assert.equal(mentionRoute.pathname, '/(tabs)/messages/chat-detail');
  assert.equal(mentionRoute.params.sourceID, 'group-2');
  assert.equal(mentionRoute.params.conversationType, 'group');
  assert.equal(mentionRoute.params.searchedMsgID, 'client-msg-2');

  const verificationRoute = resolvePushNotificationRoute({
    notificationType: 'CIRCLE_VERIFICATION_REQUESTED',
    invitationID: 'inv-3',
  });
  assert.equal(verificationRoute.pathname, '/(tabs)/discover/verification/[id]');
  assert.equal(verificationRoute.params.id, 'inv-3');

  const friendMessageRoute = resolvePushNotificationRoute({
    type: 'FRIEND_REQUEST_MESSAGE',
  });
  assert.equal(friendMessageRoute, '/(tabs)/contacts/new-friends');
});

test('root layout mounts system push notification response routing', () => {
  const rootLayout = read('app/_layout.tsx');
  const host = read(
    'src/features/notifications/components/PushNotificationRouteHandler.tsx',
  );

  assert.match(rootLayout, /PushNotificationRouteHandler/);
  assert.match(host, /addNotificationResponseReceivedListener/);
  assert.match(host, /getLastNotificationResponse/);
  assert.match(host, /clearLastNotificationResponse/);
  assert.match(host, /resolvePushNotificationRoute/);
  assert.match(host, /setNotificationHandler/);
  assert.match(host, /shouldShowBanner:\s*false/);
  assert.match(host, /logClientDiagnostic\('notification_open'/);
  assert.match(host, /usePathname/);
  assert.match(host, /router\.replace/);
});

test('root layout registers and unregisters native push tokens', () => {
  const rootLayout = read('app/_layout.tsx');
  const registrar = read(
    'src/features/notifications/components/PushNotificationTokenRegistrar.tsx',
  );
  const appConfig = JSON.parse(read('app.json'));

  assert.match(rootLayout, /PushNotificationTokenRegistrar/);
  assert.ok(appConfig.expo.plugins.includes('expo-notifications'));
  assert.match(registrar, /getExpoPushTokenAsync/);
  assert.match(registrar, /registerPushToken/);
  assert.match(registrar, /revokePushToken/);
  assert.match(registrar, /Crypto\.randomUUID/);
  assert.match(registrar, /useAppSettingsStore/);
  assert.match(registrar, /useAuthStore/);
  assert.match(registrar, /registerLogoutHandler/);
});

test('seen target matcher supports moment, chat, invitation, signup, and friend targets', () => {
  const { notificationMatchesSeenTarget } = load(
    'src/features/notifications/utils/seen-target.ts',
  );

  assert.equal(
    notificationMatchesSeenTarget(
      {
        id: 'n1',
        type: 'COMMENT_REPLY',
        read: false,
        fromTrace: { id: 'trace-1' },
        fromReply: { id: 'reply-1' },
      },
      { traceId: 'trace-1', replyId: 'reply-1' },
    ),
    true,
  );
  assert.equal(
    notificationMatchesSeenTarget(
      {
        id: 'n2',
        type: 'MEMBER_MENTION',
        read: false,
        fromMessage: {
          conversationID: 'conv-1',
          sourceID: 'group-1',
          clientMsgID: 'msg-1',
        },
      },
      { conversationID: 'conv-1', sourceID: 'group-1', messageID: 'msg-1' },
    ),
    true,
  );
  assert.equal(
    notificationMatchesSeenTarget(
      {
        id: 'n3',
        type: 'CIRCLE_VERIFICATION_REQUESTED',
        read: false,
        fromInvitation: { id: 'inv-1' },
      },
      { invitationId: 'inv-1' },
    ),
    true,
  );
  assert.equal(
    notificationMatchesSeenTarget(
      {
        id: 'n4',
        type: 'CIRCLE_POST_SIGNUP_CREATED',
        read: false,
        fromCirclePost: { id: 'post-1' },
      },
      { circlePostId: 'post-1' },
    ),
    true,
  );
  assert.equal(
    notificationMatchesSeenTarget(
      { id: 'n5', type: 'FRIEND_REQUEST_RECEIVED', read: false },
      { friendRequests: true },
    ),
    true,
  );
});

test('target screens mark matching notifications read when opened directly', () => {
  const moment = read('src/features/discover/screens/MomentDetailScreen.tsx');
  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const verification = read('src/features/discover/screens/VerificationRequestScreen.tsx');
  const invitation = read('src/features/discover/screens/InvitationVerificationScreen.tsx');
  const signups = read('src/features/notifications/screens/PostSignupsScreen.tsx');
  const friends = read('src/features/contacts/screens/NewFriendsScreen.tsx');

  for (const source of [moment, chat, verification, invitation, signups, friends]) {
    assert.match(source, /markMatchingTargetNotificationsRead/);
  }
});
