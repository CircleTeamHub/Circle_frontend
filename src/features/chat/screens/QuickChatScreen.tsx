import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import ChatDetailScreen from '@/features/chat/screens/ChatDetailScreen';
import type { EmbeddedChatParams } from '@/features/chat/chat-detail/types';
import { ChatSheetNavigationContext } from '@/features/chat/chat-detail/hooks/use-chat-router';
import { Radius, useTheme } from '@/theme';

/** 面板占屏幕(键盘以上)的比例;上面一截留着能看见原来的页面。 */
const PANEL_FLEX = 7;
const BACKDROP_FLEX = 3;

const s = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { flex: BACKDROP_FLEX },
  panel: {
    flex: PANEL_FLEX,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    overflow: 'hidden',
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: Radius.full, marginVertical: 8 },
});

type QuickChatParams = Partial<Record<keyof EmbeddedChatParams, string>>;

/**
 * 收到消息点横幅弹出的半屏聊天:能看消息、能直接回复,不用离开手上的页面(比如正在写笔记)。
 * 整页从屏幕顶端铺开、外层负责键盘避让,键盘弹起时面板跟着上移并按比例缩小;
 * 点上方空白处关闭,右上角展开成完整聊天页。
 */
export default function QuickChatScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<QuickChatParams>();
  const slide = useRef(new Animated.Value(1)).current;

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

  if (!conversationID) return null;

  return (
    <KeyboardAvoidingContainer style={[s.root, { backgroundColor: colors.overlay }]}>
      <Pressable
        style={s.backdrop}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      />
      <Animated.View
        style={[
          s.panel,
          { backgroundColor: colors.background },
          { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 600] }) }] },
        ]}
      >
        <View style={[s.grabber, { backgroundColor: colors.surfaceBorder }]} />
        <ChatSheetNavigationContext.Provider value={sheetNavigation}>
          <ChatDetailScreen key={conversationID} embedded={embedded} sheet={{ onClose: close, onExpand: expand }} />
        </ChatSheetNavigationContext.Provider>
      </Animated.View>
    </KeyboardAvoidingContainer>
  );
}
