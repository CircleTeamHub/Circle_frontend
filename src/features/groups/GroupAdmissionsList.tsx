import { mapChatConversationToUI } from "@/chat-core/mappers";
import { selectGroupConversations } from "@/features/contacts/utils/group-chat-rows";
import { useNotificationCenterStore } from "@/features/notifications/store/use-notification-center-store";
import { keyboardDismissOnDragProps } from "@/components/ui/keyboard-dismiss";
import { fetchMyApplications, markCircleInvitationSeen } from "@/services/api/circles";
import type { CircleInvitation } from "@/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  fetchGroupAdmissions,
  markGroupAdmissionSeen,
  refreshGroupAdmissionUnread,
  type GroupAdmissionDetail,
} from "@/services/api/group-admissions";
import { GroupChatAvatar } from "@/components/ui/group-chat-avatar";
import { Divider } from "@/components/ui/divider";
import { UnreadCountBadge } from "@/components/ui/unread-count-badge";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/chat-core/store";
import { ensureChatConversations } from "@/chat-core/api";
import {
  getChatDetailHref,
  type UserProfileScope,
} from "@/features/user/utils/routes";
import { reportHandledFailure } from "@/observability/report-failure";
import { getApiErrorMessage } from "@/services/api/errors";
import { useFocusReloadGate } from "@/hooks/use-focus-reload-gate";
import { groupOrCircleMutatedSince } from "@/features/chat/utils/group-reload-key";
import { Spacing, useTheme } from "@/theme";
import { getGroupEntryHref } from "./routes";
import { getGroupAdmissionRelationship, getGroupAdmissionStatus } from "./admission-copy";
type Row = {
  key: string;
  name: string;
  avatar: string | null;
  admission?: GroupAdmissionDetail;
  admissionIds?: string[];
  circleInvitationIds?: string[];
  circleInvitation?: CircleInvitation;
  groupId?: string;
  sourceId?: string;
  unreadCount: number;
  identity: string;
  updatedAt?: string;
};
export function GroupAdmissionsList({
  query = "",
  groupId,
  includeJoined = false,
  scope = "contacts",
}: {
  query?: string;
  groupId?: string;
  includeJoined?: boolean;
  scope?: UserProfileScope;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const latestNotification = useNotificationCenterStore(
    (state) =>
      state.interactive.find(
        (n) =>
          n.type === "GROUP_ADMISSION" ||
          n.type === "CIRCLE_INVITATION_RECEIVED",
      )?.id,
  );
  const sessionEpoch = useAuthStore((s) => s.sessionEpoch);
  const userId = useAuthStore((s) => s.user?.id);
  const conversations = useChatStore((s) => s.conversations);
  const [circleInvitations, setCircleInvitations] = useState<
    CircleInvitation[]
  >([]);
  const [items, setItems] = useState<GroupAdmissionDetail[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const paging = useRef(false);
  const failedCursor = useRef<string | undefined>(undefined);
  const refreshPending = useRef(false);
  const loadedEpoch = useRef<number | null>(null);
  // 从入群详情/会话回来:30 秒内、同账号、没有新的入群/圈子邀请通知、也没有群或圈子写请求
  // (审批、接受、标记已读都算),就不重拉第一页、我的申请和会话列表。
  const admissionsReloadGate = useFocusReloadGate({
    key: `${groupId ?? ""}:${latestNotification ?? ""}`,
    mutatedSince: groupOrCircleMutatedSince,
  });
  const load = useCallback(
    async function loadPage(next?: string, force = false): Promise<void> {
      if (paging.current) { if (!next) refreshPending.current = true; return; }
      paging.current = true;
      const version = generation.current;
      const startedAt = Date.now();
      if (!next) setLoading(true);
      try {
        const responses = await Promise.allSettled([
          fetchGroupAdmissions(next, groupId),
          !groupId && !next ? fetchMyApplications() : Promise.resolve(null),
          // 「已加入」只需要一份新鲜的会话列表:刚拉过就直接用,不再每次刷新都全量拉。
          includeJoined && !next ? ensureChatConversations({ force }) : Promise.resolve(null),
        ]);
        if (version !== generation.current || useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
        const [admissionsResult, circleResult] = responses;
        if (circleResult.status === 'fulfilled' && circleResult.value) setCircleInvitations(circleResult.value);
        if (admissionsResult.status === 'fulfilled') {
          const result = admissionsResult.value;
          setItems(old => next ? [...old, ...result.items.filter(row => !old.some(item => item.id === row.id))] : result.items);
          setCursor(result.nextCursor);
        }
        const failures = responses.filter((response): response is PromiseRejectedResult => response.status === 'rejected');
        failedCursor.current = next;
        setError(failures.length ? getApiErrorMessage(failures[0].reason, t('groupAdmission.loadFailed')) : '');
        for (const failure of failures) reportHandledFailure('groupAdmission', 'listSource', failure.reason);
        // 第一页各路都拉成功才算「拉过」;任一失败下次聚焦照样重试。
        if (!next && failures.length === 0) {
          loadedEpoch.current = sessionEpoch;
          admissionsReloadGate.markLoaded(startedAt);
        }
      } catch (e) {
        if (version === generation.current) {
          failedCursor.current = next;
          setError(getApiErrorMessage(e, t("groupAdmission.loadFailed")));
        }
        reportHandledFailure("groupAdmission", "list", e);
      } finally {
        if (version === generation.current) {
          setLoading(false);
          paging.current = false;
          if (refreshPending.current) { refreshPending.current = false; void loadPage(); }
        }
      }
    },
    [groupId, t, sessionEpoch, includeJoined, admissionsReloadGate],
  );
  useFocusEffect(
    useCallback(() => {
      // 角标未读数很便宜、又直接决定红点对不对:照常刷新。
      void refreshGroupAdmissionUnread().catch((e) =>
        reportHandledFailure("groupAdmission", "unread", e),
      );
      const stopInFlight = () => {
        generation.current++;
        paging.current = false;
        refreshPending.current = false;
      };
      if (admissionsReloadGate.shouldSkip()) return stopInFlight;
      generation.current++;
      paging.current = false;
      refreshPending.current = false;
      // 只有换了账号才清空;同一个账号回来时保留旧行,第一页到了再整体替换,不闪成空白。
      if (loadedEpoch.current !== sessionEpoch) {
        setItems([]);
        setCircleInvitations([]);
        setCursor(null);
      }
      void load();
      return stopInFlight;
    }, [admissionsReloadGate, load, sessionEpoch]),
  );
  const lastNotification = useRef(latestNotification);
  useEffect(() => {
    if (lastNotification.current !== latestNotification) {
      lastNotification.current = latestNotification;
      if (latestNotification) void load();
    }
  }, [latestNotification, load]);
  const rows = useMemo(() => {
    const admissions: Row[] = items.map((a) => ({
      key: a.id,
      identity: `group-${a.conversationId ?? a.group.id ?? a.id}`,
      updatedAt: a.updatedAt ?? a.createdAt,
      name: a.group.name,
      avatar: a.group.avatarUrl,
      admission: a,
      admissionIds: (a.unreadCount ?? 0) > 0 ? [a.id] : [],
      unreadCount: a.unreadCount ?? 0,
    }));
    const ownAdmissions = [...items].filter((a) => a.isApplicant || a.applicantId === userId)
      .sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''));
    const groups: Row[] = includeJoined
      ? selectGroupConversations(conversations).filter((c) => {
          const current = ownAdmissions.find((a) => a.conversationId === c.id);
          return !current || current.group.isMember;
        }).map((c) => {
          const ui = mapChatConversationToUI(c);
          return {
            key: `group-${c.id}`,
            identity: c.circleId ? `circle-${c.circleId}` : `group-${c.id}`,
            name: ui.name,
            avatar: ui.avatarUrl ?? null,
            groupId: c.id,
            sourceId: ui.sourceID,
            unreadCount: ui.unreadCount ?? 0,
          };
        })
      : [];
    const needle = query.trim().toLocaleLowerCase();
    const circleRows: Row[] = circleInvitations.map((invitation) => ({
      key: `circle-${invitation.id}`,
      identity: `circle-${invitation.circleId ?? invitation.id}`,
      updatedAt: invitation.createdAt,
      name: invitation.circleName,
      avatar: null,
      circleInvitation: invitation,
      circleInvitationIds: (invitation.unreadCount ?? 0) > 0 ? [invitation.id] : [],
      unreadCount: invitation.unreadCount ?? 0,
    }));
    // The scoped manager view still lists individual people requiring decisions.
    const allRows = [...admissions, ...circleRows].sort((a, b) =>
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
    ).concat(groups);
    const byGroup = new Map<string, Row>();
    if (!groupId) for (const row of allRows) {
      const existing = byGroup.get(row.identity);
      if (existing) {
        existing.unreadCount += row.unreadCount;
        existing.admissionIds = [...(existing.admissionIds ?? []), ...(row.admissionIds ?? [])];
        existing.circleInvitationIds = [...(existing.circleInvitationIds ?? []), ...(row.circleInvitationIds ?? [])];
        existing.groupId ??= row.groupId;
        existing.sourceId ??= row.sourceId;
      } else byGroup.set(row.identity, { ...row, key: row.identity });
    }
    return (groupId ? allRows : [...byGroup.values()]).filter(
      (row) =>
        !needle ||
        `${row.name} ${row.admission?.applicantName ?? ""} ${row.admission?.inviterName ?? ""} ${row.circleInvitation?.inviter.nickname ?? ""} ${row.circleInvitation?.applicant.nickname ?? ""}`
          .toLocaleLowerCase()
          .includes(needle),
    );
  }, [circleInvitations, conversations, groupId, includeJoined, items, query, userId]);
  return (
    <FlatList
      {...keyboardDismissOnDragProps}
      data={rows}
      keyExtractor={(row) => row.key}
      ItemSeparatorComponent={Divider}
      contentContainerStyle={{ padding: Spacing.lg }}
      refreshing={loading}
      // 用户主动下拉:会话快照也强制重拉,不复用。
      onRefresh={() => void load(undefined, true)}
      onEndReached={() => {
        if (cursor && !loading && !error) void load(cursor);
      }}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : !error ? (
          <Text style={{ color: colors.textSecondary }}>
            {t("groupAdmission.empty")}
          </Text>
        ) : null
      }
      ListFooterComponent={
        error ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void load(failedCursor.current)}
            style={{ padding: Spacing.md }}
          >
            <Text style={{ color: colors.text }}>{error}</Text>
            <Text style={{ color: colors.primary }}>{t("common.retry")}</Text>
          </Pressable>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.unreadCount > 0
            ? `${item.name}, ${t("common.unreadCount", { count: item.unreadCount })}`
            : item.name}
          onPress={() => {
            const admissionIds = item.admissionIds ?? [];
            const circleIds = item.circleInvitationIds ?? [];
            if (admissionIds.length || circleIds.length) void Promise.all([
              ...admissionIds.map(id => markGroupAdmissionSeen(id)),
              ...circleIds.map(id => markCircleInvitationSeen(id)),
            ]).then(() => {
              if (useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
              setItems(old => old.map(row => admissionIds.includes(row.id) ? { ...row, unreadCount: 0 } : row));
              setCircleInvitations(old => old.map(row => circleIds.includes(row.id) ? { ...row, unreadCount: 0 } : row));
              return refreshGroupAdmissionUnread();
            }).catch(e => reportHandledFailure('groupAdmission', 'seen', e));
            if (item.circleInvitation && item.groupId && ['APPROVED', 'ADMIN_APPROVED'].includes(item.circleInvitation.status))
              router.push(getChatDetailHref(scope, item.sourceId ?? item.groupId, item.name, item.avatar ?? undefined, item.groupId, undefined, 'group'));
            else if (item.circleInvitation)
              router.push({
                pathname: "/(tabs)/discover/invitation/[id]",
                params: { id: item.circleInvitation.id },
              });
            else if (item.admission && includeJoined && item.admission.group.canManage)
              router.push(getGroupEntryHref(scope, { groupId: item.admission.conversationId, manage: "1" }));
            else if (item.admission)
              router.push(
                getGroupEntryHref(scope, { admissionId: item.admission.id }),
              );
            else
              router.push(
                getChatDetailHref(
                  scope,
                  item.sourceId ?? item.groupId!,
                  item.name,
                  item.avatar ?? undefined,
                  item.groupId,
                  undefined,
                  "group",
                ),
              );
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.md,
            paddingVertical: Spacing.md,
          }}
        >
          <GroupChatAvatar size={44} name={item.name} uri={item.avatar} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text numberOfLines={1} style={{ color: colors.text }}>
              {item.name || t("groupAdmission.unavailable")}
            </Text>
            <Text style={{ color: colors.textSecondary }}>
              {item.circleInvitation
                ? t(
                    `groupAdmission.status.${({ INVITED: 'INVITED', PENDING: 'PENDING', APPROVED: 'JOINED', ADMIN_APPROVED: 'JOINED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' } as const)[item.circleInvitation.status]}`,
                  )
                : item.admission
                  ? `${getGroupAdmissionRelationship(item.admission, userId, t)} · ${getGroupAdmissionStatus(item.admission, userId, t)}`
                  : t("groupAdmission.status.JOINED")}
            </Text>
          </View>
          <UnreadCountBadge count={item.unreadCount} testID={`group-inbox-unread-${item.admission?.id ?? (item.circleInvitation ? `circle-${item.circleInvitation.id}` : item.key)}`} />
        </Pressable>
      )}
    />
  );
}
