import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchMessageReaders } from '@/chat-core/api';
import { Avatar } from '@/components/ui/avatar';
import { NavHeader } from '@/components/ui/nav-header';
import { reportHandledFailure } from '@/observability/report-failure';
import { Spacing, Typography, useTheme } from '@/theme';

type Reader = { id: string; nickname: string; avatarUrl: string | null };
type ReadersState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'loaded'; readers: Reader[]; total: number };

const s = StyleSheet.create({
  container: { flex: 1 },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  name: { ...Typography.body, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
  hint: { ...Typography.bodyRegular, textAlign: 'center' },
  footer: { ...Typography.small, textAlign: 'center', paddingVertical: Spacing.lg },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.lg + 40 + Spacing.md },
});

/** 群聊里自己发的一条消息的已读成员:整页列表,人多时也能完整翻看(服务端单次最多 200 人)。 */
export default function MessageReadersScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ conversationId?: string; messageId?: string }>();
  const conversationId = typeof params.conversationId === 'string' ? params.conversationId : '';
  const messageId = typeof params.messageId === 'string' ? params.messageId : '';
  const [state, setState] = useState<ReadersState>({ kind: 'loading' });

  const load = useCallback(() => {
    if (!conversationId || !messageId) {
      setState({ kind: 'failed' });
      return () => undefined;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchMessageReaders(conversationId, messageId)
      .then((result) => {
        if (!cancelled) {
          setState({ kind: 'loaded', readers: result.readers, total: result.total ?? result.readers.length });
        }
      })
      .catch((error: unknown) => {
        reportHandledFailure('messageReaders', 'fetchReaders', error);
        if (!cancelled) setState({ kind: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, messageId]);

  useEffect(() => load(), [load]);

  const title =
    state.kind === 'loaded'
      ? t('chat.messageActions.readersTitle', { count: state.total, defaultValue: '已读成员（{{count}}）' })
      : t('chat.messageActions.readers', { defaultValue: '已读成员' });

  let body;
  if (state.kind === 'loading') {
    body = (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (state.kind === 'failed') {
    body = (
      <View style={s.center}>
        <Text style={[s.hint, { color: colors.textSecondary }]}>
          {t('chat.messageActions.readersFailed', { defaultValue: '已读成员加载失败' })}
        </Text>
        <Pressable onPress={() => void load()} accessibilityRole="button">
          <Text style={[Typography.body, { color: colors.primary }]}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  } else {
    const hidden = Math.max(0, state.total - state.readers.length);
    body = (
      <FlatList
        data={state.readers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.lg }}
        ItemSeparatorComponent={() => (
          <View style={[s.separator, { backgroundColor: colors.divider }]} />
        )}
        renderItem={({ item }) => (
          <View style={s.row}>
            <Avatar size={40} shape="square" name={item.nickname} uri={item.avatarUrl ?? undefined} />
            <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>
              {item.nickname}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={s.center}>
            <Text style={[s.hint, { color: colors.textSecondary }]}>
              {t('chat.messageActions.readersNone', { defaultValue: '还没有人读到这条消息' })}
            </Text>
          </View>
        }
        ListFooterComponent={
          hidden > 0 ? (
            <Text style={[s.footer, { color: colors.textSecondary }]}>
              {t('chat.messageActions.readersMoreFooter', {
                shown: state.readers.length,
                count: hidden,
                defaultValue: '仅显示前 {{shown}} 人，另有 {{count}} 人已读',
              })}
            </Text>
          ) : null
        }
      />
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <NavHeader title={title} />
      {body}
    </View>
  );
}
