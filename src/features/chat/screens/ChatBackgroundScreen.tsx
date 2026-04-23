import { useCallback, useMemo } from 'react';
import {
  Alert,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import {
  CHAT_BACKGROUND_PRESETS,
  DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  type ChatBackgroundPreference,
  getChatBackgroundPreferenceLabel,
  resolveChatBackgroundStyle,
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  section: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
  },
  preview: {
    minHeight: 180,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    padding: Spacing.lg,
    justifyContent: 'space-between',
    gap: Spacing.lg,
  },
  previewTitle: {
    ...Typography.body,
    fontWeight: '600',
  },
  previewBubble: {
    alignSelf: 'flex-end',
    maxWidth: '72%',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  previewBubbleText: {
    ...Typography.small,
  },
  previewMeta: {
    gap: 4,
  },
  previewLabel: {
    ...Typography.caption,
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
});

export default function ChatBackgroundScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    conversationID?: string;
    title?: string;
  }>();

  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const conversationTitle =
    typeof params.title === 'string' ? params.title : '聊天背景';

  const backgroundPreference = useChatPreferencesStore(
    (state) =>
      state.backgroundsByConversationID[conversationID] ??
      DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  );
  const setChatBackgroundPreference = useChatPreferencesStore(
    (state) => state.setChatBackgroundPreference,
  );
  const backgroundStyle = useMemo(
    () => resolveChatBackgroundStyle(backgroundPreference, colors.background),
    [backgroundPreference, colors.background],
  );
  const selectedLabel = useMemo(
    () => getChatBackgroundPreferenceLabel(backgroundPreference),
    [backgroundPreference],
  );

  const applyPreference = useCallback(
    (nextPreference: ChatBackgroundPreference) => {
      if (!conversationID) {
        Alert.alert('参数缺失', '无法修改当前会话的聊天背景。');
        return;
      }

      setChatBackgroundPreference(conversationID, nextPreference);
      router.back();
    },
    [conversationID, setChatBackgroundPreference],
  );

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}>
      <NavHeader title="聊天背景" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.section, { backgroundColor: colors.surface }]}>
          <View style={[s.preview, { backgroundColor: backgroundStyle.backgroundColor }]}>
            {backgroundStyle.imageUri ? (
              <ImageBackground
                source={{ uri: backgroundStyle.imageUri }}
                style={s.imageOverlay}
                resizeMode="cover"
              >
                <View style={[s.imageOverlay, { backgroundColor: colors.overlay }]} />
              </ImageBackground>
            ) : null}
            <View style={s.previewMeta}>
              <Text style={[s.previewTitle, { color: colors.text }]}>
                {conversationTitle}
              </Text>
              <Text style={[s.previewLabel, { color: colors.textSecondary }]}>
                当前：{selectedLabel}
              </Text>
            </View>
            <View
              style={[
                s.previewBubble,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.surfaceBorder,
                  borderWidth: 1,
                },
              ]}
            >
              <Text style={[s.previewBubbleText, { color: colors.text }]}>
                这是一条预览消息
              </Text>
            </View>
          </View>
        </View>

        <View style={[s.section, { backgroundColor: colors.surface }]}>
          <MenuRow
            icon="cloud-outline"
            label="跟随全局"
            rightText={backgroundPreference.mode === 'global' ? '当前' : undefined}
            onPress={() => applyPreference(DEFAULT_CHAT_BACKGROUND_PREFERENCE)}
            showArrow={false}
          />
          <Divider />
          {CHAT_BACKGROUND_PRESETS.map((preset, index) => (
            <View key={preset.id}>
              {index > 0 ? <Divider /> : null}
              <MenuRow
                icon="color-palette-outline"
                iconBgColor={preset.color}
                label={preset.label}
                rightText={
                  backgroundPreference.mode === 'preset' &&
                  backgroundPreference.presetId === preset.id
                    ? '当前'
                    : undefined
                }
                onPress={() =>
                  applyPreference({ mode: 'preset', presetId: preset.id })
                }
                showArrow={false}
              />
            </View>
          ))}
        </View>

        <View style={[s.section, { backgroundColor: colors.surface }]}>
          <MenuRow
            icon="image-outline"
            label="自定义图片"
            rightText={backgroundPreference.mode === 'image' ? '当前' : '稍后开放'}
            onPress={() => Alert.alert('暂未开放', '图片背景稍后提供。')}
          />
        </View>
      </ScrollView>
    </View>
  );
}
