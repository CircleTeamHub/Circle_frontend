const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

test("root layout mounts the global notification snackbar host", () => {
  const rootLayout = read("app/_layout.tsx");
  assert.match(rootLayout, /NotificationSnackbarHost/);
});

test("notification snackbar host renders a tappable notification banner", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  assert.match(host, /useNotificationSnackbarStore/);
  assert.match(host, /mapNotificationToRow/);
  assert.match(host, /markNotificationRead/);
  assert.match(host, /router\.navigate/);
  assert.match(host, /router\.push/);
});

test("notification snackbar host only reuses profile routes", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  assert.match(host, /const route = getSnackbarRoute/);
  assert.match(host, /if \(isUserProfileSnackbarRoute\(route\)\)/);
  assert.match(host, /router\.navigate\(route\)/);
  assert.match(host, /router\.push\(route\)/);
});

test("notification snackbar host passes current stack scope to the route resolver", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  // 开着半屏(根上)时沿用半屏记下的来源 tab,不落成消息栈。
  assert.match(host, /onChatSheet \? \[typeof params\.originScope === 'string' \? params\.originScope : ''\] : segments/);
  assert.match(host, /originScope: notificationScope/);
  assert.match(host, /scope: notificationScope/);
});

test("notification snackbar host marks notifications read optimistically", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  assert.match(host, /useNotificationCenterStore/);
  assert.match(host, /markInteractiveReadLocal\(shown\.id\)/);
  assert.match(host, /markNotificationRead\(shown\.id\)/);
});

test("notification snackbar host keeps unread badges in sync when tapped", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  // 扣减规则收在 unread-badges.ts，与通知列表点开共用同一份。
  assert.match(host, /if \(!shown\.read\) decrementUnreadBadgesFor\(shown\.type\)/);
  const badges = read("src/features/notifications/utils/unread-badges.ts");
  assert.match(badges, /useTabBadgeStore/);
  assert.match(badges, /Math\.max\(0, badges\.discoverUnread - 1\)/);
  // systemUnread 已整体删除（#103）。
  assert.doesNotMatch(host, /systemUnread/i);
  assert.doesNotMatch(badges, /systemUnread/i);
});

test("notification snackbar host suppresses only the active conversation", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  assert.match(host, /useSegments/);
  assert.doesNotMatch(host, /onMessagesList/);
  assert.match(host, /current\.conversationID === activeConversationId/);
  assert.match(host, /shown\.conversationID === activeConversationId/);
});

test("notification snackbar host skips SYSTEM toasts via the realtime handler", () => {
  const client = read("src/realtime/client.ts");
  assert.match(client, /payload\.type === 'SYSTEM'/);
  // SYSTEM short-circuits before enqueueing a toast.
  assert.match(client, /if \(payload\.type === 'SYSTEM'\) \{\s*\n\s*return;/);
});

test("realtime bell notification allow-list includes trace mentions", () => {
  // 白名单已收敛到 notification-domain（两个铃铛的类型并集），client 只消费它。
  const domain = read("src/features/notifications/utils/notification-domain.ts");
  assert.match(domain, /'TRACE_MENTION'/);
  const client = read("src/realtime/client.ts");
  assert.match(client, /BELL_NOTIFICATION_TYPES\.has\(payload\.type\)/);
});

test("notification snackbar host supports swipe-up-to-dismiss", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  assert.match(host, /PanResponder/);
  assert.match(host, /pan\.panHandlers/);
  // Swipe past threshold clears the auto-dismiss timer then advances the queue.
  assert.match(host, /clearTimer\(\);/);
  assert.match(host, /dismissCurrent\(\);/);
});

test("notification snackbar host uses a light, neutral haptic", () => {
  const hook = read(
    "src/features/notifications/hooks/use-notification-feedback.ts",
  );
  assert.match(hook, /impactAsync\(hapticsModule\.ImpactFeedbackStyle\.Light\)/);
  assert.doesNotMatch(hook, /NotificationFeedbackType\.Success/);
});

test("notification feedback lazily creates the native audio player", () => {
  const hook = read(
    "src/features/notifications/hooks/use-notification-feedback.ts",
  );

  const mountEffect = hook.match(/useEffect\(\(\) => \{[\s\S]*?\n\s*\}, \[\]\);/);
  assert.ok(mountEffect);
  assert.doesNotMatch(mountEffect[0], /createAudioPlayer/);
  assert.match(hook, /function ensureNotificationPlayer/);
  assert.match(hook, /ensureNotificationPlayer\(ringtone\)/);
});

test("notification feedback does not load expo-audio at module startup", () => {
  const hook = read(
    "src/features/notifications/hooks/use-notification-feedback.ts",
  );

  assert.doesNotMatch(hook, /import \{[^}]*createAudioPlayer/);
  assert.doesNotMatch(hook, /import \{[^}]*setAudioModeAsync/);
  assert.match(hook, /import type \{ AudioPlayer \} from 'expo-audio'/);
  assert.match(hook, /import\('expo-audio'\)/);
});

test("notification feedback does not load expo-haptics at module startup", () => {
  const hook = read(
    "src/features/notifications/hooks/use-notification-feedback.ts",
  );

  assert.doesNotMatch(hook, /import \* as Haptics from 'expo-haptics'/);
  assert.match(hook, /import\('expo-haptics'\)/);
});

test("notification snackbar host labels banner with title and summary", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  assert.match(host, /accessibilityLabel=\{`\$\{row\.title\}\. \$\{row\.summary\}`\}/);
});

test("snackbar route resolver covers all actionable notification targets", () => {
  const route = read(
    "src/features/notifications/utils/snackbar-route.ts",
  );
  // 各类通知都在点下去的那个 tab 栈里打开(逐类逐栈的检查在 snackbar-route.test.js)。
  assert.match(route, /CIRCLE_POST_SIGNUP_CREATED/);
  assert.match(route, /pathname: `\/\(tabs\)\/\$\{scope\}\/post-signups`/);
  assert.match(route, /FRIEND_REQUEST/);
  assert.match(route, /return getNewFriendsHref\(scope\);/);
  assert.match(route, /fromTrace\?\.id/);
  assert.match(route, /getMomentDetailHref\(scope, item\.fromTrace\.id/);
});

test('admission banners preserve badges belonging to discover domains', () => {
  // 入群申请等不属于两个铃铛的通知不扣 discoverUnread（那是两个铃铛的合计口径）。
  const badges = read('src/features/notifications/utils/unread-badges.ts');
  assert.match(badges, /const domain = notificationDomain\(type\);/);
  assert.match(badges, /if \(domain === 'moments' \|\| domain === 'circle'\) \{\s*badges\.setDiscoverUnread/);
});
