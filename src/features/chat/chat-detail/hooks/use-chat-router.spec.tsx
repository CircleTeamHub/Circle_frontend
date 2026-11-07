import { Pressable, Text } from 'react-native';
import { router, useSegments } from 'expo-router';
import Stack from 'expo-router/stack';
import Tabs from 'expo-router/tabs';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import {
  ChatSheetNavigationContext,
  leaveOverChatPage,
  useChatRouter,
} from './use-chat-router';

// 用真实的 expo-router / React Navigation 跑一遍半屏聊天的跳转,看导航状态。
// 路由树照 app/_layout.tsx 的形状缩写:根栈 (tabs) / quick-chat(透明模态) /
// chat-sheet(全屏模态) / (chat);消息栈以首页垫底;另有一个别的 tab(discover)。
// 回归背景:半屏里点笔记/名片等工具时,旧实现先「展开」再压选择页 —— 用户在别的 tab 时
// 完整聊天页压不进去,选完落到消息列表;从半屏往 /(tabs)/... 跳还会在根栈多压一份 (tabs)。

type NavState = { routes: NavRoute[]; index?: number };
type NavRoute = { name: string; state?: NavState };

function Label({ text }: { text: string }) {
  return <Text>{text}</Text>;
}

function SheetChat() {
  const chatRouter = useChatRouter();
  return (
    <>
      <Pressable onPress={() => chatRouter.pushOverChat('share-picker', { type: 'note' })}>
        <Text>sheet.openPicker</Text>
      </Pressable>
      <Pressable onPress={() => chatRouter.pushOverChat('location-picker', { conversationID: 'c1' })}>
        <Text>sheet.openLocation</Text>
      </Pressable>
    </>
  );
}

function QuickChat() {
  return (
    <ChatSheetNavigationContext.Provider value={{ dismiss: () => router.back() }}>
      <SheetChat />
    </ChatSheetNavigationContext.Provider>
  );
}

function FullChat() {
  const chatRouter = useChatRouter();
  return (
    <Pressable onPress={() => chatRouter.pushOverChat('share-picker', { type: 'note' })}>
      <Text>full.openPicker</Text>
    </Pressable>
  );
}

function SheetPicker() {
  const segments = useSegments();
  return (
    <>
      <Pressable onPress={() => router.back()}>
        <Text>picker.done</Text>
      </Pressable>
      <Pressable
        onPress={() => leaveOverChatPage(segments, () => router.navigate('/(tabs)/messages/user/u1' as never))}
      >
        <Text>picker.openSource</Text>
      </Pressable>
    </>
  );
}

function renderApp() {
  return renderRouter(
    {
      _layout: () => (
        <Stack>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="quick-chat" options={{ presentation: 'transparentModal' }} />
          <Stack.Screen name="chat-sheet" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="(chat)" />
        </Stack>
      ),
      '(tabs)/_layout': () => <Tabs />,
      '(tabs)/messages/_layout': {
        unstable_settings: { initialRouteName: 'index' },
        default: () => <Stack />,
      },
      '(tabs)/messages/index': () => <Label text="messages.index" />,
      '(tabs)/messages/chat-detail': FullChat,
      '(tabs)/messages/share-picker': () => <Label text="messages.sharePicker" />,
      '(tabs)/messages/user/[id]': () => <Label text="messages.user" />,
      '(tabs)/discover/_layout': () => <Stack />,
      '(tabs)/discover/index': () => <Label text="discover.index" />,
      'quick-chat': QuickChat,
      'chat-sheet/_layout': () => <Stack />,
      'chat-sheet/share-picker': SheetPicker,
      'chat-sheet/location-picker': () => <Label text="sheet.locationPicker" />,
      '(chat)/_layout': () => <Stack />,
      '(chat)/location-picker': () => <Label text="chat.locationPicker" />,
    },
    { initialUrl: '/messages' },
  );
}

type App = ReturnType<typeof renderApp>;

/** 根栈(expo-router 外面还包了一层 __root)。 */
function rootStack(app: App): NavState {
  const state = app.getRouterState() as NavState | undefined;
  const root = state?.routes[0]?.state;
  if (!root) throw new Error('router state not ready');
  return root;
}

function rootRouteNames(app: App): string[] {
  return rootStack(app).routes.map((route) => route.name);
}

function tabStack(app: App, tab: string): string[] {
  const tabs = rootStack(app).routes.find((route) => route.name === '(tabs)')?.state;
  const stack = tabs?.routes.find((route) => route.name === tab)?.state;
  return stack ? stack.routes.map((route) => route.name) : [];
}

/** 用户待在消息之外的 tab 时,横幅弹出半屏。 */
async function openSheetFromDiscover(app: App) {
  await act(async () => {
    router.navigate('/discover');
  });
  await act(async () => {
    router.push('/quick-chat');
  });
  expect(rootRouteNames(app)).toEqual(['(tabs)', 'quick-chat']);
}

describe('半屏聊天里「选完要回到聊天」的页面', () => {
  test('选择页盖在半屏上打开,不关半屏、不动消息栈', async () => {
    const app = renderApp();
    await openSheetFromDiscover(app);

    await act(async () => {
      fireEvent.press(screen.getByText('sheet.openPicker'));
    });

    expect(rootRouteNames(app)).toEqual(['(tabs)', 'quick-chat', 'chat-sheet']);
    expect(app.getPathname()).toBe('/chat-sheet/share-picker');
    expect(app.getSearchParams()).toEqual({ type: 'note' });
    expect(tabStack(app, 'messages')).toEqual(['index']);
  });

  test('选完返回仍停在半屏(半屏重新拿到焦点后取走选择结果)', async () => {
    const app = renderApp();
    await openSheetFromDiscover(app);
    await act(async () => {
      fireEvent.press(screen.getByText('sheet.openPicker'));
    });

    await act(async () => {
      fireEvent.press(screen.getByText('picker.done'));
    });

    expect(rootRouteNames(app)).toEqual(['(tabs)', 'quick-chat']);
    expect(app.getPathname()).toBe('/quick-chat');
    expect(tabStack(app, 'messages')).toEqual(['index']);
  });

  test('选位置同样盖在半屏上,而不是压进 (chat) 栈', async () => {
    const app = renderApp();
    await openSheetFromDiscover(app);

    await act(async () => {
      fireEvent.press(screen.getByText('sheet.openLocation'));
    });

    expect(rootRouteNames(app)).toEqual(['(tabs)', 'quick-chat', 'chat-sheet']);
    expect(app.getPathname()).toBe('/chat-sheet/location-picker');
  });

  test('从选择页去资料页:选择页和半屏一起关掉,根栈只有一份 (tabs)', async () => {
    const app = renderApp();
    await openSheetFromDiscover(app);
    await act(async () => {
      fireEvent.press(screen.getByText('sheet.openPicker'));
    });

    await act(async () => {
      fireEvent.press(screen.getByText('picker.openSource'));
    });

    expect(rootRouteNames(app)).toEqual(['(tabs)']);
    expect(app.getPathname()).toBe('/messages/user/u1');
  });

  test('完整聊天页里仍压进消息栈,行为不变', async () => {
    const app = renderApp();
    await act(async () => {
      router.push('/(tabs)/messages/chat-detail' as never);
    });

    await act(async () => {
      fireEvent.press(screen.getByText('full.openPicker'));
    });

    expect(rootRouteNames(app)).toEqual(['(tabs)']);
    expect(tabStack(app, 'messages')).toEqual(['index', 'chat-detail', 'share-picker']);
  });
});
