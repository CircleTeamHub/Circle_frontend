import { Text } from 'react-native';
import { router, useNavigationContainerRef } from 'expo-router';
import Stack from 'expo-router/stack';
import Tabs from 'expo-router/tabs';
import { act, renderRouter } from 'expo-router/testing-library';
import { useSingleTabsRoot } from './use-single-tabs-root';

// 回归:根栈上的页面(搜索、扫码名片、通话、半屏聊天…)往 /(tabs)/... 跳,expo-router 会在根栈
// 再压一整份 (tabs)。两份 tab 栏同时挂着,点 tab 没反应、点「联系人」却显示圈子页。
// 根栈只允许一份 (tabs):出现第二份时,把旧的那份连同压在中间的页面一起收掉。

type NavState = { key: string; index: number; routes: { name: string; state?: NavState }[] };

function Label({ text }: { text: string }) {
  return <Text>{text}</Text>;
}

function RootLayout() {
  useSingleTabsRoot(useNavigationContainerRef());
  return (
    <Stack>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="search" />
      <Stack.Screen name="quick-chat" options={{ presentation: 'transparentModal' }} />
    </Stack>
  );
}

function renderApp() {
  return renderRouter(
    {
      _layout: RootLayout,
      '(tabs)/_layout': () => <Tabs />,
      '(tabs)/messages/_layout': { unstable_settings: { initialRouteName: 'index' }, default: () => <Stack /> },
      '(tabs)/messages/index': () => <Label text="messages.index" />,
      '(tabs)/messages/user/[id]': () => <Label text="messages.user" />,
      '(tabs)/contacts/_layout': { unstable_settings: { initialRouteName: 'index' }, default: () => <Stack /> },
      '(tabs)/contacts/index': () => <Label text="contacts.index" />,
      '(tabs)/discover/_layout': { unstable_settings: { initialRouteName: 'index' }, default: () => <Stack /> },
      '(tabs)/discover/index': () => <Label text="discover.index" />,
      search: () => <Label text="search" />,
      'quick-chat': () => <Label text="quick-chat" />,
    },
    { initialUrl: '/messages' },
  );
}

type App = ReturnType<typeof renderApp>;

function rootStack(app: App): NavState {
  const root = (app.getRouterState() as NavState | undefined)?.routes[0]?.state;
  if (!root) throw new Error('router state not ready');
  return root;
}

test.each([
  ['search', '/search'],
  ['the half-screen chat', '/quick-chat'],
])('pushing into the tabs from %s keeps a single tabs navigator and lands on the target', async (_label, overlay) => {
  const app = renderApp();
  await act(async () => {
    router.navigate('/discover');
  });
  await act(async () => {
    router.push(overlay as never);
  });

  await act(async () => {
    router.push('/(tabs)/messages/user/u1' as never);
  });

  expect(rootStack(app).routes.map((route) => route.name)).toEqual(['(tabs)']);
  expect(app.getPathname()).toBe('/messages/user/u1');
});

test('switching tabs still works afterwards', async () => {
  const app = renderApp();
  await act(async () => {
    router.push('/search' as never);
  });
  await act(async () => {
    router.push('/(tabs)/messages/user/u1' as never);
  });

  await act(async () => {
    router.navigate('/contacts');
  });

  expect(rootStack(app).routes.map((route) => route.name)).toEqual(['(tabs)']);
  expect(app.getPathname()).toBe('/contacts');
});
