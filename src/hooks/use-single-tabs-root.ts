import { useEffect } from 'react';
import { CommonActions, type NavigationContainerRefWithCurrent, type NavigationState } from '@react-navigation/native';

/**
 * 根栈只允许一份 (tabs)。
 *
 * 根栈上的页面(搜索、扫码名片、通话、半屏聊天、盖在半屏上的选择页…)往 `/(tabs)/...` 跳时,
 * expo-router 会在根栈再压一整份 (tabs),而不是回到已有的那份。两份 tab 栏同时挂着,
 * 点 tab 没反应,点「联系人」显示的却是圈子页。入口很多(页面里的链接、通知点击、
 * 转发后的「查看」…),逐个改防不住新入口,所以在根上兜住:新的一份一压上来,就把旧的那份
 * 连同压在两份之间的页面一起收掉,只留新的这份(它就是这次要去的地方)。
 *
 * 新的这份挪到底部时可能被重新挂载(盖在透明模态之上时就会),子导航器会按它的 params
 * 重建页面;那份 params 已被标记为「已消费」,原样留着会退回各 tab 首页,所以换成深拷贝。
 * 路由参数都来自 URL,JSON 拷贝不丢东西。
 *
 * 代价:旧那份里各 tab 的浏览历史不保留;压在中间的页面会被卸载(通话页卸载即挂断,
 * 通话中点通知进聊天会结束通话)。能提前关掉上层页面的入口(useChatRouter)仍应先关再跳,
 * 免得多一次转场。
 */
export function useSingleTabsRoot(navigationRef: NavigationContainerRefWithCurrent<ReactNavigation.RootParamList>): void {
  useEffect(
    () =>
      navigationRef.addListener('state', () => {
        // expo-router 在根栈外面还包了一层 __root。
        const rootStack = navigationRef.getRootState()?.routes[0]?.state as NavigationState | undefined;
        if (!rootStack) return;
        const first = rootStack.routes.findIndex((route) => route.name === '(tabs)');
        const top = rootStack.routes[rootStack.index];
        if (first < 0 || rootStack.index === first || top?.name !== '(tabs)') return;
        const params = top.params ? (JSON.parse(JSON.stringify(top.params)) as object) : undefined;
        navigationRef.dispatch({
          ...CommonActions.reset({
            ...rootStack,
            routes: [...rootStack.routes.slice(0, first), { ...top, params }],
            index: first,
          }),
          target: rootStack.key,
        });
      }),
    [navigationRef],
  );
}
