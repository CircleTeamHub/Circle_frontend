import { getGroupEntryHref } from '@/features/groups/routes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  useSegments,
} from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { fetchChatMembers, loadChatConversations } from '@/chat-core/api';
import type { ChatMemberDto } from '@/chat-core/protocol';
import {
  type GroupRole,
  resolveStandaloneSelfRole,
} from '@/features/chat/group-admin-permissions';
import { useChatStore } from '@/chat-core/store';
import { fetchCircleDetail } from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { resolveNoteCardButtons } from '@/features/notes/utils/note-card-peers';
import { NoteCard, type NoteSourceTarget } from '@/features/notes/components/NoteCard';
import type { NoteSummary, NoteWorkStatus } from '@/features/notes/types';
import {
  getChatDetailHref,
  getCircleDetailHref,
  getNoteDetailHref,
  getUserProfileScopeFromSegments,
} from '@/features/user/utils/routes';
import { useNoteStatusSignalStore } from '@/features/notes/store/use-note-status-signal-store';
import { resolveManagedWorkStatus } from '@/features/notes/utils/managed-work-status';
import {
  applyNoteSourceStatusToSummaries,
  withNoteSyncRetry,
} from '@/features/notes/utils/note-sync';
import {
  fetchNotes,
  setNoteSourceGroup,
  setNoteWorkStatus,
} from '@/services/api/notes';

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.lg, gap: Spacing.lg },
  section: { borderRadius: Radius.xl, overflow: 'hidden' },
  sectionHeader: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    gap: 2,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  countBadge: {
    minWidth: 28,
    height: 24,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    ...Typography.small,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 56,
  },
  rowText: { flex: 1, gap: 2 },
  rowAction: {
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    flexWrap: 'wrap',
  },
  emptyRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  retry: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
  },
  noteCardWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerSheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    overflow: 'hidden',
    maxHeight: '86%',
  },
  pickerBody: {
    flexShrink: 1,
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: Radius.full,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  pickerHeader: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: 2,
  },
  pickerTitle: {
    ...Typography.h2,
    fontWeight: '700',
  },
  pickerHint: {
    ...Typography.small,
  },
  pickerList: {
    flexShrink: 1,
  },
  pickerEmpty: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
});


/** 群里的来源笔记必须是当前用户拥有的原始笔记；收藏副本不能反向绑定群状态。 */
function isOwnedSourceNote(
  note: NoteSummary,
  currentUserID?: string | null,
): boolean {
  return (
    !note.collectedFrom &&
    (note.canEdit === true ||
      (Boolean(currentUserID) && note.ownerId === currentUserID))
  );
}

/** 群主专用的笔记管理页,与群策略/成员管理使用独立路由和页面。 */
export default function NoteManagementScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const segments = useSegments();
  const scope = getUserProfileScopeFromSegments(segments);
  const params = useLocalSearchParams<{
    conversationID?: string;
    groupID?: string;
  }>();
  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const groupID = typeof params.groupID === 'string' ? params.groupID : '';
  const isStandaloneGroup = !groupID;
  const currentUserID = useChatStore((state) => state.currentUserId);
  const ownerId = useChatStore(
    (state) =>
      state.conversations.find((candidate) => candidate.id === conversationID)
        ?.ownerId ?? null,
  );
  const [members, setMembers] = useState<ChatMemberDto[]>([]);
  const [circleRole, setCircleRole] = useState<GroupRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notePickerVisible, setNotePickerVisible] = useState(false);
  const noteStatusChange = useNoteStatusSignalStore((state) => state.lastChange);
  const noteStatusRecovery = useNoteStatusSignalStore(
    (state) => state.recoveryVersion,
  );
  const notesLoadSequenceRef = useRef(0);

  useEffect(() => {
    if (!noteStatusChange) return;
    setNotes((current) =>
      applyNoteSourceStatusToSummaries(current, noteStatusChange),
    );
  }, [noteStatusChange]);

  const selfRole: GroupRole | null = isStandaloneGroup
    ? resolveStandaloneSelfRole({ members, currentUserID, ownerId })
    : circleRole;
  const isOwner = selfRole === 'OWNER';

  const loadGroupContext = useCallback(async () => {
    if (!conversationID) {
      setLoading(false);
      setError(true);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const conversationsPromise = loadChatConversations().catch((err: unknown) => {
        reportHandledFailure('noteManagement', 'loadConversation', err);
        return null;
      });
      const [directory, detail] = await Promise.all([
        fetchChatMembers(conversationID),
        groupID ? fetchCircleDetail(groupID) : Promise.resolve(null),
      ]);
      setMembers(directory);
      setCircleRole(
        detail && detail.myStatus === 'ACTIVE' ? detail.myRole : null,
      );
      await conversationsPromise;
    } catch (err) {
      setError(true);
      reportHandledFailure('noteManagement', 'loadGroupContext', err);
    } finally {
      setLoading(false);
    }
  }, [conversationID, groupID]);

  useFocusEffect(
    useCallback(() => {
      void loadGroupContext();
    }, [loadGroupContext]),
  );

  const openActionError = useCallback(
    (err: unknown) => {
      reportHandledFailure('noteManagement', 'action', err);
      Alert.alert(
        t('common.errorOccurred'),
        getApiErrorMessage(err, t('common.networkError')),
      );
    },
    [t],
  );

  const loadNotes = useCallback(async () => {
    if (!isOwner) return;
    const sequence = ++notesLoadSequenceRef.current;
    setNotesLoading(true);
    try {
      const nextNotes = await withNoteSyncRetry(() => fetchNotes());
      if (sequence !== notesLoadSequenceRef.current) return;
      setNotes(nextNotes);
    } catch (err) {
      if (sequence !== notesLoadSequenceRef.current) return;
      reportHandledFailure('noteManagement', 'loadNotes', err);
      openActionError(err);
    } finally {
      if (sequence === notesLoadSequenceRef.current) setNotesLoading(false);
    }
  }, [isOwner, openActionError]);

  useFocusEffect(
    useCallback(() => {
      // 重连恢复时漏掉的状态事件只能整页重拉补回。
      void noteStatusRecovery;
      void loadNotes();
      return () => {
        notesLoadSequenceRef.current += 1;
      };
    }, [loadNotes, noteStatusRecovery]),
  );

  const sourceNotes = useMemo(
    () =>
      notes.filter(
        (note) =>
          isOwnedSourceNote(note, currentUserID) &&
          note.status === 'ACTIVE' &&
          note.sourceConversationID === conversationID,
      ),
    [conversationID, currentUserID, notes],
  );
  const unboundNotes = useMemo(
    () =>
      notes.filter(
        (note) =>
          isOwnedSourceNote(note, currentUserID) &&
          note.status === 'ACTIVE' &&
          note.sourceConversationID !== conversationID,
      ),
    [conversationID, currentUserID, notes],
  );

  const updateManagedNote = useCallback(
    async (
      note: NoteSummary,
      action: () => Promise<unknown>,
      patch: Partial<NoteSummary>,
    ) => {
      try {
        await action();
        setNotes((current) =>
          current.map((item) =>
            item.id === note.id ? { ...item, ...patch } : item,
          ),
        );
      } catch (err) {
        openActionError(err);
      }
    },
    [openActionError],
  );

  const handleBindNote = useCallback(
    (noteId: string) => {
      setNotePickerVisible(false);
      const note = notes.find((item) => item.id === noteId);
      if (!note || !isOwnedSourceNote(note, currentUserID)) return;
      void updateManagedNote(
        note,
        () => setNoteSourceGroup(note.id, conversationID),
        { sourceConversationID: conversationID },
      );
    },
    [conversationID, currentUserID, notes, updateManagedNote],
  );

  const handleUnbindNote = useCallback(
    (note: NoteSummary) => {
      Alert.alert(
        t('chat.groupManagement.noteUnbindTitle', {
          defaultValue: '解除来源群关联？',
        }),
        t('chat.groupManagement.noteUnbindHint', {
          defaultValue: '解除后，这条笔记不会再出现在本群的笔记管理里。',
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            onPress: () =>
              void updateManagedNote(
                note,
                () => setNoteSourceGroup(note.id, null),
                { sourceConversationID: null },
              ),
          },
        ],
      );
    },
    [t, updateManagedNote],
  );

  const handleSetNoteWorkStatus = useCallback(
    (note: NoteSummary, workStatus: NoteWorkStatus | null) => {
      void updateManagedNote(
        note,
        () => setNoteWorkStatus(note.id, workStatus),
        { workStatus },
      );
    },
    [updateManagedNote],
  );

  // 三态都能设：开工 / 打烊 / 清除（回到未设置，服务端收 null）。当前态不重复列出。
  const handlePickNoteWorkStatus = useCallback(
    (note: NoteSummary) => {
      const current = resolveManagedWorkStatus(note);
      const options: { value: NoteWorkStatus | null; label: string }[] = [
        {
          value: 'WORKING',
          label: t('chat.groupManagement.noteWorking', { defaultValue: '开工' }),
        },
        {
          value: 'CLOSED',
          label: t('chat.groupManagement.noteClosed', { defaultValue: '打烊' }),
        },
        {
          value: null,
          label: t('chat.groupManagement.noteClearStatus', {
            defaultValue: '清除状态',
          }),
        },
      ];
      Alert.alert(
        t('chat.groupManagement.noteStatusLabel', { defaultValue: '场地状态' }),
        undefined,
        [
          ...options
            .filter((option) => (option.value ?? 'UNSET') !== current)
            .map((option) => ({
              text: option.label,
              onPress: () => handleSetNoteWorkStatus(note, option.value),
            })),
          { text: t('common.cancel'), style: 'cancel' as const },
        ],
      );
    },
    [handleSetNoteWorkStatus, t],
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      section: { backgroundColor: colors.surface },
      title: { color: colors.text, ...Typography.body },
      action: { borderColor: colors.surfaceBorder },
      actionText: { color: colors.primary, ...Typography.small },
      actionDestructive: { color: colors.error, ...Typography.small },
      addText: { color: colors.iconAccent, ...Typography.body },
      countBadge: { backgroundColor: colors.primaryLight },
      countText: { color: colors.primary },
      empty: { color: colors.textSecondary, ...Typography.bodyRegular },
      pickerSheet: { backgroundColor: colors.surface },
      pickerHandle: { backgroundColor: colors.surfaceBorder },
      pickerTitle: { color: colors.text },
      pickerHint: { color: colors.textSecondary },
      centerText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
      },
      retry: { backgroundColor: colors.primary },
      retryText: { color: colors.white, ...Typography.body },
    }),
    [colors],
  );

  const renderAddRow = (
    label: string,
    onPress: () => void,
    disabled = false,
  ) => (
    <Pressable
      style={[s.actionRow, disabled ? { opacity: 0.5 } : null]}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID="note-management-bind-note"
    >
      <Ionicons name="add-circle-outline" size={22} color={colors.iconAccent} />
      <Text style={d.addText}>{label}</Text>
    </Pressable>
  );

  const handleOpenNote = useCallback(
    (note: NoteSummary) => {
      router.push(getNoteDetailHref(scope, note.id, note.ownerId ?? ''));
    },
    [router, scope],
  );

  // 卡片底部名片按钮与「我的笔记」同一套跳转：个人名片 → 私聊，群名片 → 群聊/圈子。
  const handleSourcePress = useCallback(
    (note: NoteSummary, target: NoteSourceTarget) => {
      const { contact, group } = resolveNoteCardButtons(note);
      const card = target === 'group' ? group : contact;
      if (!card) return;
      if (target === 'group' && card.target === 'chat') {
        router.push(getGroupEntryHref(scope, { groupId: card.conversationID ?? card.id, searchedMsgID: card.clientMsgID }));
        return;
      }
      if (card.target === 'circle') {
        router.push(getCircleDetailHref(scope === 'discover' ? 'discover' : 'messages', card.id));
        return;
      }
      router.push(
        getChatDetailHref(
          scope,
          card.id,
          card.name,
          card.faceURL ?? undefined,
          card.conversationID,
          card.clientMsgID,
          target === 'group' ? 'group' : 'private',
        ),
      );
    },
    [router, scope],
  );

  const renderNoteRow = (note: NoteSummary) => {
    const workStatus = resolveManagedWorkStatus(note);
    const workLabel =
      workStatus === 'WORKING'
        ? t('chat.groupManagement.noteWorking', { defaultValue: '开工' })
        : workStatus === 'CLOSED'
          ? t('chat.groupManagement.noteClosed', { defaultValue: '打烊' })
          : t('chat.groupManagement.noteUnset', { defaultValue: '未设置' });
    return (
      <View
        key={note.id}
        style={[s.noteCardWrap, { borderBottomColor: colors.divider }]}
      >
        <NoteCard
          note={note}
          onPress={handleOpenNote}
          onSourcePress={handleSourcePress}
          showActions={false}
          accessibilityLabel={note.title}
        />
        <View style={s.actionRow}>
          <Pressable
            style={[s.rowAction, d.action]}
            onPress={() => handlePickNoteWorkStatus(note)}
            accessibilityRole="button"
            accessibilityLabel={t('chat.groupManagement.noteStatusAction', {
              defaultValue: '切换笔记状态',
            })}
          >
            <Text style={d.actionText}>{workLabel}</Text>
          </Pressable>
          <Pressable
            style={[s.rowAction, d.action]}
            onPress={() => handleUnbindNote(note)}
            accessibilityRole="button"
            accessibilityLabel={t('common.remove', { defaultValue: '移除' })}
          >
            <Text style={d.actionDestructive}>
              {t('common.remove', { defaultValue: '移除' })}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const handleBindNoteCard = useCallback(
    (note: NoteSummary) => handleBindNote(note.id),
    [handleBindNote],
  );

  const renderUnboundNote = useCallback(
    ({ item }: { item: NoteSummary }) => (
      <NoteCard
        note={item}
        onPress={handleBindNoteCard}
        showActions={false}
        accessibilityLabel={item.title}
      />
    ),
    [handleBindNoteCard],
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (error) {
    body = (
      <View style={s.center}>
        <Text style={d.centerText}>
          {t('chat.groupManagement.loadFailed', {
            defaultValue: '笔记管理加载失败',
          })}
        </Text>
        <Pressable style={[s.retry, d.retry]} onPress={() => void loadGroupContext()}>
          <Text style={d.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  } else if (!isOwner) {
    body = (
      <View style={s.center}>
        <Text style={d.centerText}>
          {t('chat.groupManagement.noteRestricted', {
            defaultValue: '仅群主可以管理本群笔记',
          })}
        </Text>
      </View>
    );
  } else {
    body = (
      <ScrollView
        style={s.container}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.section, d.section]}>
          <View style={s.sectionHeader}>
            <View style={s.sectionTitleRow}>
              <Text style={d.title}>
                {t('chat.groupManagement.noteManagement', {
                  defaultValue: '笔记管理',
                })}
              </Text>
              <View style={[s.countBadge, d.countBadge]}>
                <Text style={[s.countText, d.countText]}>{sourceNotes.length}</Text>
              </View>
            </View>
          </View>
          {notesLoading ? (
            <ActivityIndicator style={s.emptyRow} color={colors.primary} />
          ) : null}
          {!notesLoading && sourceNotes.length === 0 ? (
            <View style={s.emptyRow}>
              <Text style={d.empty}>
                {t('chat.groupManagement.noSourceNotes', {
                  defaultValue: '本群还没有关联笔记',
                })}
              </Text>
            </View>
          ) : (
            sourceNotes.map(renderNoteRow)
          )}
          <Divider />
          {renderAddRow(
            unboundNotes.length > 0
              ? t('chat.groupManagement.bindNote', {
                  defaultValue: '关联我的笔记',
                })
              : t('chat.groupManagement.noSourceNotes', {
                  defaultValue: '暂无可关联的笔记',
                }),
            () => setNotePickerVisible(true),
            unboundNotes.length === 0,
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('chat.groupManagement.noteManagement', {
          defaultValue: '笔记管理',
        })}
      />
      {body}
      <BottomSheetModal
        visible={notePickerVisible}
        onClose={() => setNotePickerVisible(false)}
        backdropStyle={{ backgroundColor: colors.overlay }}
        sheetStyle={[
          s.pickerSheet,
          d.pickerSheet,
          { paddingBottom: insets.bottom || Spacing.lg },
        ]}
        avoidKeyboard={false}
      >
        <View style={s.pickerBody}>
          <View style={[s.pickerHandle, d.pickerHandle]} />
          <View style={s.pickerHeader}>
            <Text style={[s.pickerTitle, d.pickerTitle]}>
              {t('chat.groupManagement.bindNote', {
                defaultValue: '关联我的笔记',
              })}
            </Text>
            <Text style={[s.pickerHint, d.pickerHint]}>
              {t('chat.groupManagement.bindNoteHint', {
                defaultValue: '点击笔记卡片即可关联到本群',
              })}
            </Text>
          </View>
          <FlatList
            style={s.pickerList}
            data={unboundNotes}
            keyExtractor={(item) => item.id}
            renderItem={renderUnboundNote}
            ItemSeparatorComponent={() => (
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.divider }} />
            )}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={s.pickerEmpty}>
                <Text style={d.empty}>
                  {t('chat.groupManagement.noSourceNotes', {
                    defaultValue: '暂无可关联的笔记',
                  })}
                </Text>
              </View>
            }
          />
        </View>
      </BottomSheetModal>
    </View>
  );
}
