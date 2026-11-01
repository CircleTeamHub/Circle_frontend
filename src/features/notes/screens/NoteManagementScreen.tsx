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
import { FloatingActionButton } from '@/components/ui/floating-action-button';
import { NavHeader } from '@/components/ui/nav-header';
import { fetchChatMembers, refreshConversationOrList } from '@/chat-core/api';
import type { ChatMemberDto } from '@/chat-core/protocol';
import {
  type GroupRole,
  resolveStandaloneSelfRole,
} from '@/features/chat/group-admin-permissions';
import { useChatStore } from '@/chat-core/store';
import { fetchCircleDetail } from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import { Radius, Spacing, Typography, useTheme, withAlpha } from '@/theme';
import {
  NoteCard,
  type NoteSourceTarget,
} from '@/features/notes/components/NoteCard';
import type { NoteSummary, NoteWorkStatus } from '@/features/notes/types';
import {
  getChatDetailHref,
  getCircleDetailHref,
  getNoteDetailHref,
  getUserProfileScopeFromSegments,
  toCircleScope,
} from '@/features/user/utils/routes';
import { resolveNoteCardButtons } from '@/features/notes/utils/note-card-peers';
import { useNoteStatusSignalStore } from '@/features/notes/store/use-note-status-signal-store';
import { resolveManagedWorkStatus } from '@/features/notes/utils/managed-work-status';
import {
  applyNoteSourceStatusToSummaries,
  withNoteSyncRetry,
} from '@/features/notes/utils/note-sync';
import {
  fetchNotes,
  notesMutatedSince,
  setNoteSourceGroup,
  setNoteWorkStatus,
} from '@/services/api/notes';
import { useFocusReloadGate } from '@/hooks/use-focus-reload-gate';
import { reuseUnchanged } from '@/utils/structural-sharing';

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.md, gap: Spacing.md },
  // 与「我的笔记」一致：每条笔记是独立卡片，条目之间留白而不是连成一整块。
  surfaceCard: {
    borderRadius: Radius.xl,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  listHeader: {
    paddingHorizontal: Spacing.xs,
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
  noteItem: { gap: Spacing.sm },
  // 卡片下方单独一排操作按钮，与卡片本体分开，避免误触进详情。
  noteActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  noteActionButton: {
    flex: 1,
    minWidth: 0,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.sm,
  },
  noteActionText: {
    flexShrink: 1,
    ...Typography.small,
    fontWeight: '600',
  },
  emptyRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  retry: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
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
  pickerListContent: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  pickerSeparator: { height: Spacing.sm },
  pickerEmpty: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
});

// 选择器里的卡片同样逐张分开，只留白不画线。
function PickerSeparator() {
  return <View style={s.pickerSeparator} />;
}

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
      // 只需要这一个群的 DTO:单个取,不再为它重拉整张会话列表。
      const conversationsPromise = refreshConversationOrList(conversationID).catch(
        (err: unknown) => {
          reportHandledFailure('noteManagement', 'loadConversation', err);
          return null;
        },
      );
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

  // 回到页面时:刚拉过、之后没有任何笔记写请求、重连恢复信号也没变,就不重拉整页笔记。
  const notesReloadGate = useFocusReloadGate({
    key: noteStatusRecovery,
    mutatedSince: notesMutatedSince,
  });

  const loadNotes = useCallback(async () => {
    if (!isOwner) return;
    const sequence = ++notesLoadSequenceRef.current;
    const startedAt = Date.now();
    setNotesLoading(true);
    try {
      const nextNotes = await withNoteSyncRetry(() => fetchNotes());
      if (sequence !== notesLoadSequenceRef.current) return;
      setNotes((current) => reuseUnchanged(current, nextNotes));
      notesReloadGate.markLoaded(startedAt);
    } catch (err) {
      if (sequence !== notesLoadSequenceRef.current) return;
      reportHandledFailure('noteManagement', 'loadNotes', err);
      openActionError(err);
    } finally {
      if (sequence === notesLoadSequenceRef.current) setNotesLoading(false);
    }
  }, [isOwner, notesReloadGate, openActionError]);

  useFocusEffect(
    useCallback(() => {
      // 重连恢复时漏掉的状态事件只能整页重拉补回。
      void noteStatusRecovery;
      if (!notesReloadGate.shouldSkip()) void loadNotes();
      return () => {
        notesLoadSequenceRef.current += 1;
      };
    }, [loadNotes, noteStatusRecovery, notesReloadGate]),
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
        return false;
      }
      return true;
    },
    [openActionError],
  );

  const handleBindNote = useCallback(
    (noteId: string) => {
      setNotePickerVisible(false);
      const note = notes.find((item) => item.id === noteId);
      if (!note || !isOwnedSourceNote(note, currentUserID)) return;
      // 新关联进群的笔记默认开工；已经设过开工/打烊的保留原状态。
      const needsDefaultStatus = resolveManagedWorkStatus(note) === 'UNSET';
      void (async () => {
        try {
          await setNoteSourceGroup(note.id, conversationID);
        } catch (err) {
          openActionError(err);
          return;
        }
        setNotes((current) =>
          current.map((item) =>
            item.id === note.id
              ? { ...item, sourceConversationID: conversationID }
              : item,
          ),
        );
        if (needsDefaultStatus) {
          const updated = await updateManagedNote(
            note,
            () => setNoteWorkStatus(note.id, 'WORKING'),
            { workStatus: 'WORKING' },
          );
          if (!updated) {
            try { await setNoteSourceGroup(note.id, note.sourceConversationID ?? null); }
            catch (rollbackError) { openActionError(rollbackError); }
            await loadNotes();
          }
        }
      })();
    },
    [conversationID, currentUserID, notes, openActionError, updateManagedNote, loadNotes],
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

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      surfaceCard: {
        backgroundColor: colors.surface,
        borderColor: withAlpha(colors.surfaceBorder, 0.72),
      },
      title: { color: colors.text, ...Typography.body, fontWeight: '600' as const },
      actionButton: {
        backgroundColor: colors.surface,
        borderColor: withAlpha(colors.surfaceBorder, 0.72),
      },
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

  // 右上角加号和右下角悬浮钮是同一个入口：打开「关联笔记」选择器。
  const canBindNotes = !loading && !error && isOwner;
  const bindNoteLabel = t('chat.groupManagement.bindNote', {
    defaultValue: '关联笔记',
  });
  const openNotePicker = useCallback(() => setNotePickerVisible(true), []);

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
        router.push(getCircleDetailHref(toCircleScope(scope), card.id));
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
    const statusButtons: {
      value: Exclude<NoteWorkStatus, 'UNSET'>;
      label: string;
      icon: 'checkmark-circle-outline' | 'moon-outline';
      fill: string;
    }[] = [
      {
        value: 'WORKING',
        label: t('chat.groupManagement.noteWorking', { defaultValue: '开工' }),
        icon: 'checkmark-circle-outline',
        fill: colors.workingFill,
      },
      {
        value: 'CLOSED',
        label: t('chat.groupManagement.noteClosed', { defaultValue: '打烊' }),
        icon: 'moon-outline',
        fill: colors.closedFill,
      },
    ];
    return (
      <View key={note.id} style={s.noteItem}>
        <NoteCard
          note={note}
          onPress={handleOpenNote}
          onSourcePress={handleSourcePress}
          showActions={false}
          accessibilityLabel={note.title}
        />
        <View style={s.noteActions}>
          {statusButtons.map((option) => {
            const active = workStatus === option.value;
            return (
              <Pressable
                key={option.value}
                style={[
                  s.noteActionButton,
                  d.actionButton,
                  active
                    ? { backgroundColor: option.fill, borderColor: option.fill }
                    : null,
                ]}
                // 已是当前状态再点不做事，避免误触清掉状态。
                onPress={
                  active
                    ? undefined
                    : () => handleSetNoteWorkStatus(note, option.value)
                }
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: active }}
              >
                <Ionicons
                  name={option.icon}
                  size={16}
                  color={active ? colors.onStatusFill : colors.textSecondary}
                />
                <Text
                  style={[
                    s.noteActionText,
                    { color: active ? colors.onStatusFill : colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[s.noteActionButton, d.actionButton]}
            onPress={() => handleUnbindNote(note)}
            accessibilityRole="button"
            accessibilityLabel={t('chat.groupManagement.noteUnbindAction', {
              defaultValue: '移除（与本群解绑）',
            })}
          >
            <Ionicons name="remove-circle-outline" size={16} color={colors.error} />
            <Text style={[s.noteActionText, { color: colors.error }]} numberOfLines={1}>
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
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 96 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.listHeader}>
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
          <View style={[s.surfaceCard, d.surfaceCard, s.emptyRow]}>
            <Text style={d.empty}>
              {t('chat.groupManagement.noSourceNotes', {
                defaultValue: '本群还没有关联笔记',
              })}
            </Text>
          </View>
        ) : (
          sourceNotes.map(renderNoteRow)
        )}
      </ScrollView>
    );
  }

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('chat.groupManagement.noteManagement', {
          defaultValue: '笔记管理',
        })}
        rightIcon={canBindNotes ? 'add' : undefined}
        onRightPress={canBindNotes ? openNotePicker : undefined}
        rightAccessibilityLabel={bindNoteLabel}
      />
      {body}
      {canBindNotes ? (
        <FloatingActionButton
          style={{ bottom: insets.bottom + Spacing.lg }}
          onPress={openNotePicker}
          label={bindNoteLabel}
          testID="note-management-bind-note"
        />
      ) : null}
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
                defaultValue: '关联笔记',
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
            contentContainerStyle={s.pickerListContent}
            ItemSeparatorComponent={PickerSeparator}
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
