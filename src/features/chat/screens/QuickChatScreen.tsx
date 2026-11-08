import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import ChatDetailScreen from '@/features/chat/screens/ChatDetailScreen';
import type { EmbeddedChatParams } from '@/features/chat/chat-detail/types';
import { ChatSheetNavigationContext } from '@/features/chat/chat-detail/hooks/use-chat-router';
import { Radius, useTheme } from '@/theme';

/** 面板占屏幕(键盘以上)的比例;上面一截留着能看见原来的页面。 */
const PANEL_FLEX = 7;
const BACKDROP_FLEX = 3;
/** 进出场的位移:slide 的 1 对应这么多 pt。 */
const SLIDE_DISTANCE = 600;
/** 能拖动的区域:横条 20 + 标题行 60。从下面的消息列表开始的下拉要留给列表滚动。 */
const DRAG_ZONE_HEIGHT = 80;
// 下拉关闭的判定和 BottomSheetModal 一致。
const DRAG_ACTIVATION_DISTANCE = 10;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 1.6;
const DISMISS_FLING_MIN_DISTANCE = 48;
const DISMISS_DURATION = 180;

const s = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { flex: BACKDROP_FLEX },
  panel: {
    flex: PANEL_FLEX,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    // 暗色下半屏和背后的页面都是纯黑,蒙层也压不出差别,靠这圈描边划出面板的边界。
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: 'hidden',
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: Radius.full, marginVertical: 8 },
});

type QuickChatParams = Partial<Record<keyof EmbeddedChatParams, string>>;

/**
 * 收到消息点横幅弹出的半屏聊天:能看消息、能直接回复,不用离开手上的页面(比如正在写笔记)。
 * 整页从屏幕顶端铺开、外层负责键盘避让,键盘弹起时面板跟着上移并按比例缩小;
 * 点上方空白处或按住顶部往下拖关闭,右上角展开成完整聊天页。
 */
export default function QuickChatScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<QuickChatParams>();
  const slide = useRef(new Animated.Value(1)).current;
  // 表情 / 「+」面板顶替键盘占住底部,开着时外层不再给键盘留白,否则面板会叠在
  // 还没收完的键盘留白上,把聊天区挤扁。
  const [composerPanelOpen, setComposerPanelOpen] = useState(false);

  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }).start();
  }, [slide]);

  const conversationID = typeof params.conversationID === 'string' ? params.conversationID : '';
  const embedded: EmbeddedChatParams = {
    conversationID,
    sourceID: params.sourceID,
    title: params.title,
    conversationType: params.conversationType === 'group' ? 'group' : 'private',
    avatarUrl: params.avatarUrl,
    searchedMsgID: params.searchedMsgID,
  };

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, []);

  const expand = useCallback(() => {
    close();
    router.push({
      pathname: '/(tabs)/messages/chat-detail',
      params: {
        conversationID,
        ...(params.sourceID ? { sourceID: params.sourceID } : {}),
        ...(params.title ? { title: params.title } : {}),
        ...(params.conversationType ? { conversationType: params.conversationType } : {}),
        ...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : {}),
      },
    });
  }, [close, conversationID, params.avatarUrl, params.conversationType, params.sourceID, params.title]);

  // 发笔记 / 名片 / 转账等「选完回到聊天」的页面盖在半屏上打开,不再借道展开;
  // 只有右上角展开才进完整聊天页(sheet.onExpand)。
  const sheetNavigation = useMemo(() => ({ dismiss: close }), [close]);
  const sheetActions = useMemo(
    () => ({ onClose: close, onExpand: expand, onPanelOpenChange: setComposerPanelOpen }),
    [close, expand],
  );

  // 面板上沿的纵坐标。整页铺满窗口,和手势的 moveY 是同一坐标系。
  const panelTopRef = useRef(0);
  const dragResponder = useMemo(() => {
    const springBack = () => {
      Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
    };
    return PanResponder.create({
      // 捕获阶段判定:标题行的按钮按下时已是响应者,真的往下拖才接过来,点按不受影响。
      // 接管之前 y0 还是 0,起点只能用当前位置减去已移动的距离来算。
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        gesture.moveY - gesture.dy - panelTopRef.current <= DRAG_ZONE_HEIGHT &&
        gesture.dy > DRAG_ACTIVATION_DISTANCE &&
        gesture.dy > Math.abs(gesture.dx) * 1.5,
      onPanResponderTerminationRequest: () => false,
      // 接管时 dy 清零,从这里开始算就是跟手的,面板不会跳一下。
      onPanResponderMove: (_event, gesture) => {
        slide.setValue(Math.max(0, gesture.dy) / SLIDE_DISTANCE);
      },
      onPanResponderRelease: (_event, gesture) => {
        const dragged = Math.max(0, gesture.dy);
        if (dragged > DISMISS_DISTANCE || (gesture.vy > DISMISS_VELOCITY && dragged > DISMISS_FLING_MIN_DISTANCE)) {
          // 不把位移复位:模态还要淡出,复位会让面板先跳回原位再消失。
          Animated.timing(slide, { toValue: 1, duration: DISMISS_DURATION, useNativeDriver: true }).start(() => close());
          return;
        }
        springBack();
      },
      onPanResponderTerminate: springBack,
    });
  }, [close, slide]);

  if (!conversationID) return null;

  return (
    <KeyboardAvoidingContainer enabled={!composerPanelOpen} style={[s.root, { backgroundColor: colors.overlay }]}>
      <Pressable
        style={s.backdrop}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      />
      <Animated.View
        {...dragResponder.panHandlers}
        testID="quick-chat-panel"
        onLayout={(event) => {
          panelTopRef.current = event.nativeEvent.layout.y;
        }}
        style={[
          s.panel,
          { backgroundColor: colors.background, borderColor: colors.surfaceBorder },
          { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, SLIDE_DISTANCE] }) }] },
        ]}
      >
        <View testID="quick-chat-grabber" style={[s.grabber, { backgroundColor: colors.textSecondary }]} />
        <ChatSheetNavigationContext.Provider value={sheetNavigation}>
          <ChatDetailScreen key={conversationID} embedded={embedded} sheet={sheetActions} />
        </ChatSheetNavigationContext.Provider>
      </Animated.View>
    </KeyboardAvoidingContainer>
  );
}
