import { mapChatConversationToUI } from "@/chat-core/mappers";
import { selectGroupConversations } from "@/features/contacts/utils/group-chat-rows";
import { useNotificationCenterStore } from "@/features/notifications/store/use-notification-center-store";
import { keyboardDismissOnDragProps } from "@/components/ui/keyboard-dismiss";
import { fetchMyApplications } from "@/services/api/circles";
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
  refreshGroupAdmissionUnread,
  type GroupAdmissionDetail,
} from "@/services/api/group-admissions";
import { GroupChatAvatar } from "@/components/ui/group-chat-avatar";
import { Divider } from "@/components/ui/divider";
import { UnreadCountBadge } from "@/components/ui/unread-count-badge";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/chat-core/store";
import { loadChatConversations } from "@/chat-core/api";
import {
  getChatDetailHref,
  type UserProfileScope,
} from "@/features/user/utils/routes";
import { reportHandledFailure } from "@/observability/report-failure";
import { getApiErrorMessage } from "@/services/api/errors";
import { Spacing, useTheme } from "@/theme";
import { getGroupEntryHref } from "./routes";
import { getGroupAdmissionRelationship, getGroupAdmissionStatus } from "./admission-copy";
type Row = {
  key: string;
  name: string;
  avatar: string | null;
  admission?: GroupAdmissionDetail;
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
  const load = useCallback(
    async (next?: string) => {
      if (paging.current) return;
      paging.current = true;
      const version = generation.current;
      if (!next) setLoading(true);
      try {
        const [result, circleRows] = await Promise.all([
          fetchGroupAdmissions(next, groupId),
          !groupId && !next ? fetchMyApplications() : Promise.resolve(null),
        ]);
        if (
          version !== generation.current ||
          useAuthStore.getState().sessionEpoch !== sessionEpoch
        )
          return;
        if (circleRows) setCircleInvitations(circleRows);
        setItems((old) =>
          next
            ? [
                ...old,
                ...result.items.filter(
                  (row) => !old.some((item) => item.id === row.id),
                ),
              ]
            : result.items,
        );
        setCursor(result.nextCursor);
        setError("");
      } catch (e) {
        if (version === generation.current)
          setError(getApiErrorMessage(e, t("groupAdmission.loadFailed")));
        reportHandledFailure("groupAdmission", "list", e);
      } finally {
        if (version === generation.current) {
          setLoading(false);
          paging.current = false;
        }
      }
    },
    [groupId, t, sessionEpoch],
  );
  useFocusEffect(
    useCallback(() => {
      generation.current++;
      paging.current = false;
      setItems([]);
      setCircleInvitations([]);
      setCursor(null);
      void load();
      void refreshGroupAdmissionUnread().catch((e) =>
        reportHandledFailure("groupAdmission", "unread", e),
      );
      if (includeJoined)
        void loadChatConversations().catch((e) =>
          reportHandledFailure("groupAdmission", "joinedGroups", e),
        );
      return () => {
        generation.current++;
        paging.current = false;
      };
    }, [includeJoined, load]),
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
      onRefresh={() => void load()}
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
            onPress={() => void load(cursor ?? undefined)}
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
            if (item.circleInvitation)
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
                    item.circleInvitation.status === "INVITED"
                      ? "groupAdmission.status.INVITED"
                      : "groupAdmission.status.PENDING",
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
