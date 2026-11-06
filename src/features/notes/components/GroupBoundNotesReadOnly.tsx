import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { NoteCard, type NoteSourceTarget } from '@/features/notes/components/NoteCard';
import {
  type NoteSourceStatusChange,
  useNoteStatusSignalStore,
} from '@/features/notes/store/use-note-status-signal-store';
import type { NoteSummary } from '@/features/notes/types';
import { applyNoteSourceStatusToSummaries } from '@/features/notes/utils/note-sync';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';
import { fetchGroupBoundNotes } from '@/services/api/notes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

interface GroupBoundNotesReadOnlyProps {
  conversationID: string;
  onOpenNote: (note: NoteSummary) => void;
  onSourcePress: (note: NoteSummary, target: NoteSourceTarget) => void;
}

type LoadState = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'loaded' };

const s = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  hint: { ...Typography.small, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
  centerText: { ...Typography.bodyRegular, textAlign: 'center' },
  retry: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.full },
});

/**
 * 普通群成员看到的「群笔记」:群主绑定到本群的笔记和它们的开工/打烊/下架状态,只读。
 * 回到页面、重连恢复时重拉;收到的状态实时事件直接叠到列表上。
 */
export function GroupBoundNotesReadOnly({
  conversationID,
  onOpenNote,
  onSourcePress,
}: GroupBoundNotesReadOnlyProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const sequenceRef = useRef(0);
  // 请求在途时到达的状态事件:快照可能是事件之前读的,回来后要再叠一遍,不能被旧快照盖掉。
  const inFlightRef = useRef<{ startVersion: number; changes: NoteSourceStatusChange[] } | null>(null);
  const statusChange = useNoteStatusSignalStore((store) => store.lastChange);
  const recoveryVersion = useNoteStatusSignalStore((store) => store.recoveryVersion);

  const load = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    const inFlight = {
      startVersion: useNoteStatusSignalStore.getState().version,
      changes: [] as NoteSourceStatusChange[],
    };
    inFlightRef.current = inFlight;
    try {
      const next = await fetchGroupBoundNotes(conversationID);
      if (sequence !== sequenceRef.current) return;
      setNotes(inFlight.changes.reduce(applyNoteSourceStatusToSummaries, next));
      setState({ kind: 'loaded' });
    } catch (error) {
      if (sequence !== sequenceRef.current) return;
      reportHandledFailure('noteManagement', 'loadBoundNotes', error);
      setState({
        kind: 'failed',
        message: getApiErrorMessage(
          error,
          t('chat.groupManagement.loadFailed', { defaultValue: '笔记管理加载失败' }),
        ),
      });
    } finally {
      if (inFlightRef.current === inFlight) inFlightRef.current = null;
    }
  }, [conversationID, t]);

  useFocusEffect(
    useCallback(() => {
      // 重连恢复时漏掉的状态事件只能整页重拉补回。
      void recoveryVersion;
      void load();
      return () => {
        sequenceRef.current += 1;
      };
    }, [load, recoveryVersion]),
  );

  useEffect(() => {
    if (!statusChange) return;
    const inFlight = inFlightRef.current;
    const changeVersion =
      useNoteStatusSignalStore.getState().sourceVersions[statusChange.sourceNoteId] ?? 0;
    if (inFlight && changeVersion > inFlight.startVersion) inFlight.changes.push(statusChange);
    setNotes((current) => applyNoteSourceStatusToSummaries(current, statusChange));
  }, [statusChange]);

  if (state.kind === 'loading' && notes.length === 0) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (state.kind === 'failed' && notes.length === 0) {
    return (
      <View style={s.center}>
        <Text style={[s.centerText, { color: colors.text }]}>{state.message}</Text>
        <Pressable
          style={[s.retry, { backgroundColor: colors.surface }]}
          onPress={() => {
            setState({ kind: 'loading' });
            void load();
          }}
          accessibilityRole="button"
        >
          <Text style={[Typography.body, { color: colors.primary }]}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={notes}
      keyExtractor={(note) => note.id}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.xl }]}
      ListHeaderComponent={
        <Text style={[s.hint, { color: colors.textSecondary }]}>
          {t('chat.groupManagement.boundNotesHint', {
            defaultValue: '群主关联到本群的笔记，状态会随群主的设置实时更新。',
          })}
        </Text>
      }
      renderItem={({ item }) => (
        <NoteCard
          note={item}
          onPress={onOpenNote}
          onSourcePress={onSourcePress}
          showActions={false}
          accessibilityLabel={item.title}
        />
      )}
      ListEmptyComponent={
        <View style={s.center}>
          <Text style={[s.centerText, { color: colors.textSecondary }]}>
            {t('chat.groupManagement.noSourceNotes', { defaultValue: '本群还没有关联笔记' })}
          </Text>
        </View>
      }
    />
  );
}
