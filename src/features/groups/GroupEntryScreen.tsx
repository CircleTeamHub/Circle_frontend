import { useNotificationCenterStore } from "@/features/notifications/store/use-notification-center-store";
import { GroupAdmissionsList } from "./GroupAdmissionsList";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  useSegments,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { NavHeader } from "@/components/ui/nav-header";
import { GroupChatAvatar } from "@/components/ui/group-chat-avatar";
import {
  getChatDetailHref,
  getCircleDetailHref,
  getUserProfileScopeFromSegments,
} from "@/features/user/utils/routes";
import { useAuthStore } from "@/stores/authStore";
import {
  fetchGroupAdmission,
  fetchGroupPreview,
  actOnGroupAdmission,
  applyToGroup,
  markGroupAdmissionSeen,
  type GroupAdmissionDetail,
  type GroupPreview,
  type GroupAdmissionAction,
} from "@/services/api/group-admissions";
import { getApiErrorMessage } from "@/services/api/errors";
import { reportHandledFailure } from "@/observability/report-failure";
import { groupAdmissionActions } from "./admission-actions";
import { getGroupAdmissionRelationship, getGroupAdmissionStatus } from "./admission-copy";
import { Radius, Spacing, useTheme } from "@/theme";
export default function GroupEntryScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scope = getUserProfileScopeFromSegments(useSegments());
  const params = useLocalSearchParams<{
    groupId?: string;
    admissionId?: string;
    searchedMsgID?: string;
    manage?: string;
  }>();
  const groupId = typeof params.groupId === "string" ? params.groupId : "";
  const admissionId =
    typeof params.admissionId === "string" ? params.admissionId : "";
  const latestStatus = useNotificationCenterStore(
    (state) =>
      state.interactive.find((n) => n.fromGroupAdmission?.id === admissionId)
        ?.fromGroupAdmission?.status,
  );
  const userId = useAuthStore((s) => s.user?.id);
  const sessionEpoch = useAuthStore((s) => s.sessionEpoch);
  const [group, setGroup] = useState<GroupPreview | null>(null);
  const [detail, setDetail] = useState<GroupAdmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const generation = useRef(0);
  const pending = useRef(false);
  const actionGeneration = useRef(0);
  useEffect(() => {
    actionGeneration.current++;
    pending.current = false;
    setBusy(false);
    setReason("");
  }, [groupId, admissionId, userId, sessionEpoch]);
  const openChat = useCallback(
    (g: GroupPreview) =>
      router.replace(
        getChatDetailHref(
          scope,
          g.id,
          g.name,
          g.avatarUrl ?? undefined,
          g.id,
          params.searchedMsgID,
          "group",
        ),
      ),
    [params.searchedMsgID, router, scope],
  );
  const load = useCallback(
    async (autoEnter = false) => {
      const version = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const record = admissionId
          ? await fetchGroupAdmission(admissionId)
          : null;
        const next = record?.group ?? (await fetchGroupPreview(groupId));
        if (
          version !== generation.current ||
          useAuthStore.getState().sessionEpoch !== sessionEpoch
        )
          return;
        setGroup(next);
        setDetail(record);
        if (next.circleId && !next.isMember) {
          router.replace(
            getCircleDetailHref(
              scope === "discover" ? "discover" : "messages",
              next.circleId,
            ),
          );
          return;
        }
        if (autoEnter && !admissionId && params.manage !== "1" && next.isMember)
          openChat(next);
        if (record || next.admission)
          void markGroupAdmissionSeen((record ?? next.admission)!.id).catch(
            (e) => reportHandledFailure("groupAdmission", "markSeen", e),
          );
      } catch (e) {
        if (version === generation.current) {
          setGroup(null);
          setDetail(null);
          setError(getApiErrorMessage(e, t("groupAdmission.loadFailed")));
          reportHandledFailure("groupAdmission", "load", e);
        }
      } finally {
        if (version === generation.current) setLoading(false);
      }
    },
    [
      admissionId,
      groupId,
      openChat,
      params.manage,
      router,
      scope,
      t,
      sessionEpoch,
    ],
  );
  useFocusEffect(
    useCallback(() => {
      setGroup(null);
      setDetail(null);
      void load(true);
      return () => {
        generation.current++;
      };
    }, [load]),
  );
  const lastNotificationStatus = useRef(latestStatus);
  useEffect(() => {
    if (lastNotificationStatus.current !== latestStatus) {
      lastNotificationStatus.current = latestStatus;
      if (latestStatus) void load();
    }
  }, [latestStatus, load]);
  const run = async (action?: GroupAdmissionAction) => {
    if (!group || pending.current) return;
    pending.current = true;
    const operation = ++actionGeneration.current;
    setBusy(true);
    const version = generation.current;
    try {
      if (action && detail) await actOnGroupAdmission(detail.id, action);
      else {
        const applied = await applyToGroup(group.id, reason) as { id?: string };
        if (admissionId && applied.id && applied.id !== admissionId &&
            version === generation.current && useAuthStore.getState().sessionEpoch === sessionEpoch) {
          router.setParams({ admissionId: applied.id });
          return;
        }
      }
      if (
        version === generation.current &&
        useAuthStore.getState().sessionEpoch === sessionEpoch
      )
        await load();
    } catch (e) {
      if (
        version === generation.current &&
        useAuthStore.getState().sessionEpoch === sessionEpoch
      ) {
        Alert.alert(
          t("groupAdmission.actionFailed"),
          getApiErrorMessage(e, t("groupAdmission.actionUncertain")),
        );
        await load();
      }
      reportHandledFailure("groupAdmission", "action", e);
    } finally {
      if (operation === actionGeneration.current) {
        pending.current = false;
        if (useAuthStore.getState().sessionEpoch === sessionEpoch)
          setBusy(false);
      }
    }
  };
  const admission = detail ?? group?.admission;
  const canApply =
    group &&
    !group.unavailable &&
    !group.isMember &&
    group.cardJoinEnabled &&
    (!admission ||
      ["REJECTED", "DECLINED", "EXPIRED", "LEFT"].includes(admission.status));
  const button = (label: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={[
        s.button,
        { backgroundColor: colors.primary, opacity: busy ? 0.5 : 1 },
      ]}
    >
      <Text style={{ color: colors.white }}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      }}
    >
      <NavHeader title={t("groupAdmission.title")} />
      {params.manage === "1" && group?.canManage ? (
        <GroupAdmissionsList groupId={group.id} scope={scope} />
      ) : (
        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            s.body,
            { paddingBottom: insets.bottom + Spacing.lg },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : error ? (
            <>
              <Text style={{ color: colors.text }}>{error}</Text>
              {button(t("common.retry"), () => void load())}
            </>
          ) : group ? (
            <>
              <View style={[s.card, { backgroundColor: colors.surface }]}>
                <GroupChatAvatar
                  size={64}
                  name={group.name}
                  uri={group.avatarUrl}
                />
                <Text style={[s.name, { color: colors.text }]}>
                  {group.name}
                </Text>
                <Text style={{ color: colors.textSecondary }}>
                  {t("groupAdmission.members", { count: group.memberCount })}
                </Text>
                {detail ? (
                  <Text style={{ color: colors.text }}>
                    {getGroupAdmissionRelationship(detail, userId, t)}
                  </Text>
                ) : null}
                {admission ? (
                  <Text style={{ color: colors.textSecondary }}>
                    {detail ? getGroupAdmissionStatus(detail, userId, t)
                      : t(`groupAdmission.status.${admission.status}`)}
                  </Text>
                ) : null}
                {detail?.reason ? (
                  <Text style={{ color: colors.text }}>{detail.reason}</Text>
                ) : null}
                {group.unavailable ? (
                  <Text style={{ color: colors.textSecondary }}>
                    {t("groupAdmission.unavailable")}
                  </Text>
                ) : !group.isMember ? (
                  <Text style={{ color: colors.textSecondary }}>
                    {t(
                      (detail?.requiresApproval ?? admission?.requiresApproval ?? group.joinApprovalRequired)
                        ? "groupAdmission.reviewRequired"
                        : "groupAdmission.acceptRequired",
                    )}
                  </Text>
                ) : null}
              </View>
              {busy ? <ActivityIndicator color={colors.primary} /> : null}
              {group.isMember
                ? button(t("groupAdmission.enter"), () => openChat(group))
                : null}
              {detail
                ? groupAdmissionActions(detail).map((action) =>
                    button(
                      t(`groupAdmission.${action}`),
                      () => void run(action),
                    ),
                  )
                : null}
              {!detail && admission?.status === "INVITED"
                ? button(t("groupAdmission.viewInvitation"), () =>
                    router.setParams({ admissionId: admission.id }),
                  )
                : null}
              {canApply ? (
                <>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    maxLength={200}
                    multiline
                    editable={!busy}
                    accessibilityLabel={t("groupAdmission.reason")}
                    placeholder={t("groupAdmission.reason")}
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      s.input,
                      { color: colors.text, borderColor: colors.surfaceBorder },
                    ]}
                  />
                  {button(t("groupAdmission.apply"), () => void run())}
                </>
              ) : null}
              {!group.isMember && !group.cardJoinEnabled && !admission ? (
                <Text style={{ color: colors.textSecondary }}>
                  {t("groupAdmission.applicationDisabled")}
                </Text>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  body: { padding: Spacing.lg, gap: Spacing.md },
  card: {
    padding: Spacing.lg,
    borderRadius: Radius.xl,
    alignItems: "center",
    gap: Spacing.md,
  },
  name: { fontSize: 20, fontWeight: "600", textAlign: "center" },
  button: {
    minHeight: 48,
    padding: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.md,
  },
  input: {
    minHeight: 80,
    borderWidth: 1,
    padding: Spacing.md,
    borderRadius: Radius.md,
    textAlignVertical: "top",
  },
});
