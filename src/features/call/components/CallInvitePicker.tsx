import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheetFlatList, BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { topNotice } from '@/components/app/top-notice-store';
import { fetchChatMembers } from '@/chat-core/api';
import { groupMemberDisplayName } from '@/features/chat/group-member-display';
import { RetryIntentKeyStore } from '@/features/profile/retry-intent-key';
import { inviteCallParticipants } from '@/services/api/calls';
import { fetchFriends } from '@/services/api/friends';
import { getApiErrorMessage } from '@/services/api/errors';
import { allowPeerMediaUrl } from '@/services/api/utils';
import { useAuthStore } from '@/stores/authStore';
import { reportHandledFailure } from '@/observability/report-failure';
import { generateIdempotencyKey } from '@/utils/idempotency-key';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import type { CallSession } from '@/features/call/types';

interface CallInvitePickerProps {
  visible: boolean;
  onClose: () => void;
  call: CallSession;
  onInvited: (call: CallSession) => void;
}

interface Candidate {
  id: string;
  name: string;
  avatarUrl: string | null;
  searchText: string;
}

const MAX_INVITEES = 100;

export function CallInvitePicker({ visible, onClose, call, onInvited }: CallInvitePickerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const selfId = useAuthStore((state) => state.user?.id);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [query, setQuery] = useState('');
  const [selectedIDs, setSelectedIDs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const currentCallRef = useRef(call);
  currentCallRef.current = call;
  const [intentKeys] = useState(() => new RetryIntentKeyStore(generateIdempotencyKey));
  const mode = call.invitationMode ?? (call.sessionType === 'single' ? 'contacts' : 'members');

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setCandidates([]);
    setSelectedIDs([]);
    setQuery('');
    setLoading(true);
    setLoadFailed(false);
    const load = async (): Promise<Candidate[]> => {
      if (mode === 'contacts') {
        const friends = await fetchFriends();
        return friends.map((friend) => ({
          id: friend.id,
          name: friend.remark?.trim() || friend.nickname,
          avatarUrl: friend.avatarUrl,
          searchText: `${friend.remark ?? ''} ${friend.nickname} ${friend.accountId}`.toLowerCase(),
        }));
      }
      const members = await fetchChatMembers(call.conversationID);
      return members.map((member) => ({
        id: member.userId,
        name: groupMemberDisplayName(member),
        avatarUrl: allowPeerMediaUrl(member.avatarUrl),
        searchText: `${member.alias ?? ''} ${member.nickname} ${member.userId}`.toLowerCase(),
      }));
    };
    load().then((list) => {
      if (!cancelled) setCandidates(list);
    }).catch((error) => {
      reportHandledFailure('call', 'loadInviteCandidates', error);
      if (!cancelled) setLoadFailed(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [call.conversationID, call.id, loadAttempt, mode, visible]);

  const participantStatus = useMemo(
    () => new Map(call.participants.map((participant) => [participant.user.id, participant.status])),
    [call.participants],
  );
  const rows = useMemo(() => {
    const byID = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    for (const { user, status } of call.participants) {
      if ((status === 'JOINED' || status === 'INVITED') && !byID.has(user.id)) {
        byID.set(user.id, {
          id: user.id, name: user.nickname, avatarUrl: allowPeerMediaUrl(user.avatarUrl),
          searchText: user.nickname.toLowerCase(),
        });
      }
    }
    return [...byID.values()];
  }, [call.participants, candidates]);
  const disabled = (id: string) =>
    id === selfId || participantStatus.get(id) === 'JOINED' || participantStatus.get(id) === 'INVITED';
  const canInvite = call.status === 'ACTIVE' && Boolean(selfId && participantStatus.get(selfId) === 'JOINED');
  const eligibleIDs = new Set(candidates.filter((item) => !disabled(item.id)).map((item) => item.id));
  const selected = selectedIDs.filter((id) => eligibleIDs.has(id));
  const keyword = query.trim().toLowerCase();
  const filtered = keyword ? rows.filter((item) => item.searchText.includes(keyword)) : rows;
  const submitLabel = t('call.invite.submit', { count: selected.length });

  const toggle = (id: string) => {
    if (disabled(id) || submitting) return;
    if (selected.includes(id)) {
      setSelectedIDs(selected.filter((item) => item !== id));
    } else if (selected.length >= MAX_INVITEES) {
      Alert.alert(t('call.invite.selectionLimit', { count: MAX_INVITEES }));
    } else {
      setSelectedIDs([...selected, id]);
    }
  };

  const submit = async () => {
    if (inFlightRef.current || !canInvite || selected.length === 0) return;
    const callId = call.id;
    const invitees = [...selected].sort();
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const updated = await intentKeys.run(JSON.stringify([callId, invitees]), (idempotencyKey) =>
        inviteCallParticipants(callId, invitees, { idempotencyKey }),
      );
      if (!mountedRef.current || currentCallRef.current.id !== callId || currentCallRef.current.status !== 'ACTIVE') return;
      onInvited(updated);
      topNotice.success(t('call.invite.sent'));
      onClose();
    } catch (error) {
      reportHandledFailure('call', 'inviteParticipants', error);
      if (mountedRef.current && currentCallRef.current.id === callId && currentCallRef.current.status === 'ACTIVE') {
        Alert.alert(getApiErrorMessage(error, t('call.invite.failed')));
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      sheetStyle={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + Spacing.md }]}
    >
      <View style={[styles.handle, { backgroundColor: colors.surfaceBorder }]} />
      <View style={styles.header}>
        <Text style={[Typography.h3, { color: colors.text, flex: 1 }]}>{t('call.invite.addTitle')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={[styles.search, { backgroundColor: colors.background }]}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          value={query}
          onChangeText={setQuery}
          placeholder={t('call.invite.searchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      {loading ? <ActivityIndicator style={styles.feedback} color={colors.primary} /> : loadFailed ? (
        <View style={styles.feedback}>
          <Text style={[Typography.bodyRegular, { color: colors.textSecondary }]}>{t('call.invite.loadFailed')}</Text>
          <Pressable accessibilityRole="button" onPress={() => setLoadAttempt((value) => value + 1)} hitSlop={10}>
            <Text style={[Typography.body, { color: colors.link }]}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <BottomSheetFlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          style={styles.list}
          {...keyboardDismissOnDragProps}
          ListEmptyComponent={<Text style={[styles.empty, { color: colors.textSecondary }]}>{t('call.invite.empty')}</Text>}
          renderItem={({ item }) => {
            const unavailable = disabled(item.id);
            const checked = selected.includes(item.id);
            const status = item.id === selfId ? t('call.self') :
              participantStatus.get(item.id) === 'JOINED' ? t('call.invite.alreadyJoined') :
                participantStatus.get(item.id) === 'INVITED' ? t('call.invite.alreadyInvited') : '';
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={item.name}
                accessibilityState={{ checked, disabled: unavailable || submitting || !canInvite }}
                disabled={unavailable || submitting || !canInvite}
                onPress={() => toggle(item.id)}
                style={[styles.row, unavailable && styles.unavailable]}
              >
                <Avatar name={item.name} uri={item.avatarUrl ?? undefined} size={40} />
                <View style={styles.rowText}>
                  <Text style={[Typography.body, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                  {status ? <Text style={[Typography.small, { color: colors.textSecondary }]}>{status}</Text> : null}
                </View>
                <Ionicons
                  name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                  size={23}
                  color={checked ? colors.iconAccent : colors.textSecondary}
                />
              </Pressable>
            );
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
        disabled={submitting || loading || loadFailed || !canInvite || selected.length === 0}
        onPress={submit}
        style={[
          styles.submit,
          { backgroundColor: colors.primary },
          (submitting || loading || loadFailed || !canInvite || selected.length === 0) && styles.unavailable,
        ]}
      >
        {submitting ? <ActivityIndicator color={colors.white} /> :
          <Text style={[Typography.body, { color: colors.white }]}>{submitLabel}</Text>}
      </Pressable>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { height: '78%', borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, paddingTop: Spacing.sm },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.lg, gap: Spacing.md },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm, paddingHorizontal: Spacing.md, height: 40, borderRadius: Radius.md,
  },
  searchInput: { ...Typography.bodyRegular, flex: 1, padding: 0 },
  list: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg },
  rowText: { flex: 1, gap: 2 },
  unavailable: { opacity: 0.45 },
  feedback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  empty: { ...Typography.bodyRegular, textAlign: 'center', padding: Spacing.xl },
  submit: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.md, minHeight: 46, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center',
  },
});
