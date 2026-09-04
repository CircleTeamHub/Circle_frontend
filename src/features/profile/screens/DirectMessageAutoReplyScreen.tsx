import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
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

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  row: { minHeight: 64, borderRadius: Radius.xl, paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: { minHeight: 120, borderRadius: Radius.xl, borderWidth: 1, padding: Spacing.lg, textAlignVertical: 'top' },
  status: { minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  error: { textAlign: 'center' },
  headerAction: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  retry: { minHeight: 44, paddingHorizontal: Spacing.md, alignItems: 'center', justifyContent: 'center' },
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
    card: { backgroundColor: colors.surface },
    label: { color: colors.text, ...Typography.body },
    help: { color: colors.textSecondary, ...Typography.caption },
    error: { color: colors.error, ...Typography.caption },
    input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.surfaceBorder, ...Typography.bodyRegular },
  }), [colors]);

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
      if (!userId || !loaded || loading || saving) return;
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

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('settingsDetails.autoReply.title', { defaultValue: '私信自动回复' })}
        rightSlot={
          <Pressable
            style={s.headerAction}
            disabled={!dirty || loading || saving}
            accessibilityRole="button"
            accessibilityLabel={t('common.save', { defaultValue: '保存' })}
            onPress={() => void savePreference(preference)}
          >
            <Text
              style={[
                d.label,
                { color: dirty ? colors.primary : colors.textSecondary },
              ]}
            >
              {t('common.save', { defaultValue: '保存' })}
            </Text>
          </Pressable>
        }
      />
      <View style={s.content}>
        <View style={[s.row, d.card]}>
          <Text style={d.label}>{t('settingsDetails.autoReply.enabled', { defaultValue: '启用自动回复' })}</Text>
          <ThemedSwitch
            tint={colors.blue}
            value={preference.enabled}
            onValueChange={(value) => {
              if (!userId) return;
              setDraftEnabled(userId, value);
            }}
            disabled={!userId || !loaded || loading || saving}
          />
        </View>
        <Text style={d.help}>{t('settingsDetails.autoReply.help', { defaultValue: '收到私聊消息时自动发送；同一会话 30 秒内最多回复一次。' })}</Text>
        <TextInput
          style={[s.input, d.input]}
          value={preference.message}
          onChangeText={(value) => {
            if (userId) setDraftMessage(userId, value);
          }}
          placeholder={t('settingsDetails.autoReply.placeholder', { defaultValue: '填写自动回复内容' })}
          placeholderTextColor={colors.textSecondary}
          multiline
          maxLength={200}
          editable={Boolean(userId) && loaded && !loading && !saving}
        />
        <Text style={d.help}>{preference.message.length}/200</Text>
        <View style={s.status}>
          {loading || saving ? <ActivityIndicator color={colors.primary} /> : null}
          {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}
          {error && !loaded && !loading ? (
            <Pressable
              style={s.retry}
              accessibilityRole="button"
              onPress={() => void loadSettings()}
            >
              <Text style={d.label}>
                {t('common.retry', { defaultValue: '重试' })}
              </Text>
            </Pressable>
          ) : null}
          {dirty && !saving ? (
            <Text style={d.help}>
              {t('settingsDetails.autoReply.unsaved', {
                defaultValue: '有未保存的更改',
              })}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
