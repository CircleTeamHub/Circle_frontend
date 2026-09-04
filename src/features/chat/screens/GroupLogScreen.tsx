import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { NavHeader } from '@/components/ui/nav-header';
import { searchChatMessages } from '@/chat-core/api';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { systemNoticeText } from '@/chat-core/message-mappers';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.sm },
  card: { padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, gap: Spacing.xs },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  retry: { marginTop: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.lg },
});

function getSystemLogText(message: ChatMessageDto): string {
  const localized = systemNoticeText(message.content);
  if (localized) return localized;
  for (const key of ['text', 'message', 'title', 'description']) {
    const value = message.content[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export default function GroupLogScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ conversationID?: string; title?: string }>();
  const conversationID = typeof params.conversationID === 'string' ? params.conversationID : '';
  const [entries, setEntries] = useState<ChatMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!conversationID) {
      setLoading(false);
      setError(true);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const page = await searchChatMessages(conversationID, {
        types: ['system'],
        limit: 100,
      });
      setEntries([...page.messages].reverse());
    } catch (err) {
      setError(true);
      reportHandledFailure('groupLog', 'load', err);
    } finally {
      setLoading(false);
    }
  }, [conversationID]);

  useEffect(() => {
    void load();
  }, [load]);

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      card: { backgroundColor: colors.surface, borderColor: colors.surfaceBorder },
      text: { color: colors.text, ...Typography.bodyRegular },
      meta: { color: colors.textSecondary, ...Typography.small },
      empty: { color: colors.textSecondary, ...Typography.bodyRegular, textAlign: 'center' as const },
      retry: { backgroundColor: colors.primary },
      retryText: { color: colors.white, ...Typography.body },
    }),
    [colors],
  );

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('chat.groupLog', { defaultValue: '群日志' })} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={s.center}>
          <Text style={d.empty}>{t('chat.groupLogLoadFailed', { defaultValue: '群日志加载失败' })}</Text>
          <Pressable style={[s.retry, d.retry]} onPress={() => void load()}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={entries.length ? s.content : s.center}
          ListEmptyComponent={<Text style={d.empty}>{t('chat.noGroupLog', { defaultValue: '暂无群日志' })}</Text>}
          renderItem={({ item }) => (
            <View style={[s.card, d.card]}>
              <Text style={d.text}>{getSystemLogText(item) || t('chat.groupActivity', { defaultValue: '群聊活动' })}</Text>
              <Text style={d.meta}>{new Date(item.createdAt).toLocaleString()}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}
