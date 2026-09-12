import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { useChatStore } from '@/chat-core/store';
import {
  type DirectMessageAutoReplyPreference,
  useDirectMessageAutoReplyStore,
} from '@/features/profile/store/use-direct-message-auto-reply-store';
import {
  fetchPrivacySettings,
  type PrivacySettings,
  updatePrivacySettings,
} from '@/services/api/privacy';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

// 版式对齐 settings-detail：分区标题 + 圆角卡片 + 卡片下方的脚注说明。
const s = StyleSheet.create({
  container: { flex: 1 },
  section: { gap: Spacing.sm },
  card: { borderRadius: Radius.xl, overflow: 'hidden' },
  row: {
    minHeight: 64,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  rowLabel: { flex: 1 },
  // 开关必须自己待在一个居中的盒子里。直接当 row 的子元素时它会顶到行首，
  // 行上的 alignItems 拉不动它 —— settings-detail 的行同样是这么包的。
  rowControl: { alignItems: 'center', justifyContent: 'center' },
  // 输入框直接坐在卡片里：不再自带边框，否则卡片里套一个框，两层圆角打架。
  input: {
    minHeight: 140,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    textAlignVertical: 'top',
  },
  // 脚注：说明、状态、字数都放到卡片外面，卡片里只留真正能操作的东西。
  footnote: {
    paddingHorizontal: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  footnoteText: { flex: 1 },
  banner: {
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bannerText: { flex: 1 },
  loadingRow: { minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  headerAction: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  // 深色主题里 textSecondary 就是纯白，只换颜色的话禁用态照样亮得像能点。
  headerActionDisabled: { opacity: 0.4 },
  retry: { minHeight: 32, paddingHorizontal: Spacing.sm, alignItems: 'center', justifyContent: 'center' },
});

const EMPTY_PREFERENCE: DirectMessageAutoReplyPreference = {
  enabled: false,
  message: '',
};

function preferenceFromSettings(
  settings: PrivacySettings,
): DirectMessageAutoReplyPreference {
  return {
    enabled: settings.directMessageAutoReplyEnabled ?? false,
    message: (settings.directMessageAutoReplyText ?? '').slice(0, 200),
  };
}

export default function DirectMessageAutoReplyScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const userId = useChatStore((state) => state.currentUserId) ?? '';
  const preference = useDirectMessageAutoReplyStore(
    (state) => state.byUserId[userId] ?? EMPTY_PREFERENCE,
  );
  const setPreference = useDirectMessageAutoReplyStore(
    (state) => state.setPreference,
  );
  const setDraftEnabled = useDirectMessageAutoReplyStore(
    (state) => state.setDraftEnabled,
  );
  const setDraftMessage = useDirectMessageAutoReplyStore(
    (state) => state.setDraftMessage,
  );
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const serverPreference = useRef(EMPTY_PREFERENCE);
  const d = useMemo(() => ({
    container: { backgroundColor: colors.background },
    content: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: insets.bottom + Spacing.xl,
      gap: Spacing.lg,
    },
    sectionTitle: {
      color: colors.textSecondary,
      ...Typography.caption,
      fontWeight: '700' as const,
    },
    card: { backgroundColor: colors.surface },
    label: { color: colors.text, ...Typography.body },
    // 暗色下次要文字就是纯白（theme 的明确决定：层级靠字号/字重，不靠明度），
    // 所以脚注只能用更小更轻的字压下去，不能加透明度。
    footnote: { color: colors.textSecondary, ...Typography.small, lineHeight: 18 },
    counter: { color: colors.textSecondary, ...Typography.small },
    error: { color: colors.error, ...Typography.small, lineHeight: 18 },
    banner: { backgroundColor: colors.surface },
    retryText: { color: colors.primary, ...Typography.caption, fontWeight: '600' as const },
    input: { color: colors.text, ...Typography.bodyRegular },
  }), [colors, insets.bottom]);

  const loadSettings = useCallback(async () => {
    const request = ++requestSequence.current;
    serverPreference.current = EMPTY_PREFERENCE;
    setLoaded(false);
    if (!userId) {
      setLoading(false);
      return;
    }

    setPreference(userId, EMPTY_PREFERENCE);
    setLoading(true);
    setSaving(false);
    setError(null);
    try {
      const settings = await fetchPrivacySettings();
      if (
        request !== requestSequence.current ||
        useChatStore.getState().currentUserId !== userId
      ) {
        return;
      }
      const next = preferenceFromSettings(settings);
      serverPreference.current = next;
      setPreference(userId, next);
      setLoaded(true);
    } catch (requestError) {
      if (
        request !== requestSequence.current ||
        useChatStore.getState().currentUserId !== userId
      ) {
        return;
      }
      setError(
        getApiErrorMessage(
          requestError,
          t('settingsDetails.autoReply.loadFailed', {
            defaultValue: '自动回复设置加载失败',
          }),
        ),
      );
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [setPreference, t, userId]);

  useEffect(() => {
    void loadSettings();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadSettings]);

  const savePreference = useCallback(
    async (next: DirectMessageAutoReplyPreference) => {
      if (
        !userId ||
        !loaded ||
        loading ||
        saving ||
        (next.enabled && !next.message.trim())
      ) {
        return;
      }
      const request = ++requestSequence.current;
      const previous = serverPreference.current;
      setPreference(userId, next);
      setSaving(true);
      setError(null);
      try {
        const updated = await updatePrivacySettings({
          directMessageAutoReplyEnabled: next.enabled,
          directMessageAutoReplyText: next.message.trim(),
        });
        if (
          request !== requestSequence.current ||
          useChatStore.getState().currentUserId !== userId
        ) {
          return;
        }
        const authoritative = preferenceFromSettings(updated);
        serverPreference.current = authoritative;
        setPreference(userId, authoritative);
      } catch (requestError) {
        if (
          request !== requestSequence.current ||
          useChatStore.getState().currentUserId !== userId
        ) {
          return;
        }
        setPreference(userId, previous);
        setError(
          getApiErrorMessage(
            requestError,
            t('settingsDetails.autoReply.saveFailed', {
              defaultValue: '自动回复设置保存失败',
            }),
          ),
        );
      } finally {
        if (request === requestSequence.current) setSaving(false);
      }
    },
    [loaded, loading, saving, setPreference, t, userId],
  );

  const dirty =
    loaded &&
    (preference.enabled !== serverPreference.current.enabled ||
      preference.message !== serverPreference.current.message);
  const replyTextRequired =
    loaded && preference.enabled && !preference.message.trim();
  const canSave = dirty && !replyTextRequired && !loading && !saving;

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('settingsDetails.autoReply.title', { defaultValue: '私信自动回复' })}
        rightSlot={
          <Pressable
            style={[s.headerAction, canSave ? null : s.headerActionDisabled]}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel={t('common.save', { defaultValue: '保存' })}
            accessibilityState={{ disabled: !canSave }}
            onPress={() => void savePreference(preference)}
          >
            <Text
              style={[
                d.label,
                { color: canSave ? colors.primary : colors.textSecondary },
              ]}
            >
              {t('common.save', { defaultValue: '保存' })}
            </Text>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={d.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.section}>
          <Text style={d.sectionTitle}>
            {t('settingsDetails.autoReply.switchSection', {
              defaultValue: '自动回复',
            })}
          </Text>
          <View style={[s.card, d.card]}>
            <View style={s.row}>
              <Text style={[s.rowLabel, d.label]}>
                {t('settingsDetails.autoReply.enabled', {
                  defaultValue: '启用自动回复',
                })}
              </Text>
              <View style={s.rowControl}>
                <ThemedSwitch
                  tint={colors.primary}
                  value={preference.enabled}
                  onValueChange={(value) => {
                    if (!userId) return;
                    setDraftEnabled(userId, value);
                  }}
                  disabled={!userId || !loaded || loading || saving}
                />
              </View>
            </View>
          </View>
          <Text style={d.footnote}>
            {t('settingsDetails.autoReply.help', {
              defaultValue:
                '收到私聊消息时自动发送；同一会话 30 秒内最多回复一次。',
            })}
          </Text>
        </View>

        <View style={s.section}>
          <Text style={d.sectionTitle}>
            {t('settingsDetails.autoReply.contentSection', {
              defaultValue: '回复内容',
            })}
          </Text>
          <View style={[s.card, d.card]}>
            <TextInput
              style={[s.input, d.input]}
              value={preference.message}
              onChangeText={(value) => {
                if (userId) setDraftMessage(userId, value);
              }}
              placeholder={t('settingsDetails.autoReply.placeholder', {
                defaultValue: '填写自动回复内容',
              })}
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={200}
              editable={Boolean(userId) && loaded && !loading && !saving}
            />
          </View>
          <View style={s.footnote}>
            <Text
              style={[
                s.footnoteText,
                replyTextRequired ? d.error : d.footnote,
              ]}
            >
              {replyTextRequired
                ? t('settingsDetails.autoReply.messageRequired', {
                    defaultValue: '开启自动回复前请填写回复内容',
                  })
                : dirty && !saving
                  ? t('settingsDetails.autoReply.unsaved', {
                      defaultValue: '有未保存的更改',
                    })
                  : ''}
            </Text>
            <Text style={d.counter}>{preference.message.length}/200</Text>
          </View>
        </View>

        {loading || saving ? (
          <View style={s.loadingRow}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {/* 加载/保存失败：一条带图标的卡片，重试贴在同一行右侧，不再是页面中间飘着的红字。 */}
        {error ? (
          <View style={[s.banner, d.banner]}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={[s.bannerText, d.error]}>{error}</Text>
            {!loaded && !loading ? (
              <Pressable
                style={s.retry}
                accessibilityRole="button"
                onPress={() => void loadSettings()}
              >
                <Text style={d.retryText}>
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
