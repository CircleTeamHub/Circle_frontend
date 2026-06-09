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
  assert.match(host, /router\.push/);
});

test("notification snackbar host delegates routing to the pure resolver", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  // Routing decisions live in (and are tested by) snackbar-route.ts.
  assert.match(host, /getSnackbarRoute/);
  assert.match(host, /router\.push\(\s*getSnackbarRoute/);
});

test("notification snackbar host marks notifications read optimistically", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  assert.match(host, /useNotificationCenterStore/);
  assert.match(host, /markInteractiveReadLocal\(shown\.id\)/);
  assert.match(host, /markNotificationRead\(shown\.id\)/);
});

test("notification snackbar host suppresses chat banners on the messages list", () => {
  const host = read(
    "src/features/notifications/components/NotificationSnackbarHost.tsx",
  );
  assert.match(host, /useSegments/);
  assert.match(host, /onMessagesList/);
  assert.match(host, /shown\.kind === 'chat' && onMessagesList/);
});

test("notification snackbar host skips SYSTEM toasts via the realtime handler", () => {
  const client = read("src/realtime/client.ts");
  assert.match(client, /payload\.type === 'SYSTEM'/);
  // SYSTEM short-circuits before enqueueing a toast.
  assert.match(client, /if \(payload\.type === 'SYSTEM'\) \{\s*\n\s*return;/);
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
  assert.match(hook, /ensureNotificationPlayer\(\)/);
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
  assert.match(route, /CIRCLE_POST_SIGNUP_CREATED/);
  assert.match(route, /\/\(tabs\)\/messages\/post-signups/);
  assert.match(route, /FRIEND_REQUEST/);
  assert.match(route, /\/\(tabs\)\/contacts\/new-friends/);
  assert.match(route, /fromTrace\?\.id/);
  assert.match(route, /\/\(tabs\)\/discover\/moment\/\[id\]/);
});
