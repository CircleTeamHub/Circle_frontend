import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Divider } from "@/components/ui/divider";
import { NavHeader } from "@/components/ui/nav-header";
import {
  type AuthSession,
  fetchAuthSessions,
  logoutOtherSessions,
  revokeAuthSession,
} from "@/services/api/auth";
import { getApiErrorMessage } from "@/services/api/errors";
import { clearLocalSession } from "@/services/auth/session";
import { Radius, Spacing, Typography, useTheme } from "@/theme";

const ICON_BOX_SIZE = 32;

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.lg,
  },
  // 所有设备放进同一张卡片，行内分隔线，和其他设置页一致。
  card: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    overflow: "hidden",
  },
  row: {
    minHeight: 64,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBox: {
    width: ICON_BOX_SIZE,
    height: ICON_BOX_SIZE,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  dividerInset: {
    marginLeft: ICON_BOX_SIZE + 12,
  },
  titleBlock: {
    flex: 1,
    gap: Spacing.xs,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  titleText: {
    flexShrink: 1,
  },
  badge: {
    borderRadius: Radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  button: {
    minHeight: 32,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  footerButton: {
    minHeight: 48,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  stateBlock: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
});

function formatDate(value: string, fallback: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

function getDeviceTitle(session: AuthSession, fallback: string) {
  return session.deviceName?.trim() || session.userAgent?.trim() || fallback;
}

// 只看设备名 / UA 里的平台字样选个图标，认不出就用通用图标。
function getDeviceIcon(session: AuthSession): keyof typeof Ionicons.glyphMap {
  const text = `${session.deviceName ?? ""} ${session.userAgent ?? ""}`;
  if (/iphone|ipad|ios|android/i.test(text)) return "phone-portrait-outline";
  if (/mac|windows|linux|mozilla|chrome|safari|firefox|edge|web/i.test(text)) {
    return "laptop-outline";
  }
  return "hardware-chip-outline";
}

export default function LoginDeviceManagementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.background,
      },
      content: {
        paddingBottom: insets.bottom + Spacing.xl,
      },
      card: {
        backgroundColor: colors.surface,
      },
      title: {
        color: colors.text,
        ...Typography.body,
      },
      caption: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      iconBox: {
        backgroundColor: colors.primaryLight,
      },
      badge: {
        backgroundColor: colors.primary,
      },
      badgeText: {
        color: colors.white,
        ...Typography.tiny,
      },
      button: {
        borderColor: colors.error,
      },
      buttonText: {
        color: colors.error,
        ...Typography.caption,
      },
      footerButton: {
        backgroundColor: colors.error,
      },
      footerButtonDisabled: {
        opacity: 0.5,
      },
      footerButtonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: "700" as const,
      },
      error: {
        color: colors.error,
        ...Typography.caption,
      },
    }),
    [colors, insets.bottom],
  );

  const loadSessions = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        setSessions(await fetchAuthSessions());
      } catch (requestError) {
        setError(
          getApiErrorMessage(
            requestError,
            t("settingsDetails.accountSecurity.deviceManagement.loadFailed"),
          ),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // 本机排第一，其余按服务端顺序。
  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)),
    [sessions],
  );

  async function revokeSession(session: AuthSession) {
    setSubmittingId(session.id);
    setError(null);
    try {
      await revokeAuthSession(session.id);
      if (session.isCurrent) {
        await clearLocalSession(undefined, { reason: 'user-session-revoke', userInitiated: true });
        router.replace("/(auth)/login");
        return;
      }
      await loadSessions();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          t("settingsDetails.accountSecurity.deviceManagement.removeFailed"),
        ),
      );
    } finally {
      setSubmittingId(null);
    }
  }

  function confirmRevokeSession(session: AuthSession) {
    Alert.alert(
      t("settingsDetails.accountSecurity.deviceManagement.removeTitle"),
      session.isCurrent
        ? t(
            "settingsDetails.accountSecurity.deviceManagement.removeCurrentMessage",
          )
        : t("settingsDetails.accountSecurity.deviceManagement.removeMessage"),
      [
        { text: t("common.cancel", { defaultValue: "取消" }), style: "cancel" },
        {
          text: session.isCurrent
            ? t(
                "settingsDetails.accountSecurity.deviceManagement.logoutCurrent",
              )
            : t("settingsDetails.accountSecurity.deviceManagement.remove"),
          style: "destructive",
          onPress: () => void revokeSession(session),
        },
      ],
    );
  }

  async function handleLogoutOthers() {
    setSubmittingId("others");
    setError(null);
    try {
      await logoutOtherSessions();
      await loadSessions();
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          t(
            "settingsDetails.accountSecurity.deviceManagement.logoutOthersFailed",
          ),
        ),
      );
    } finally {
      setSubmittingId(null);
    }
  }

  const hasOtherSessions = sessions.some((session) => !session.isCurrent);

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t("settingsDetails.accountSecurity.deviceManagement.title")}
      />
      <ScrollView
        contentContainerStyle={[s.content, d.content]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadSessions("refresh")}
            tintColor={colors.tabBarActive}
            colors={[colors.tabBarActive]}
          />
        }
      >
        {loading ? (
          <View style={s.stateBlock}>
            <ActivityIndicator color={colors.primary} />
            <Text style={d.caption}>
              {t("settingsDetails.accountSecurity.deviceManagement.loading")}
            </Text>
          </View>
        ) : sessions.length === 0 ? (
          <View style={s.stateBlock}>
            <Text style={d.caption}>
              {t("settingsDetails.accountSecurity.deviceManagement.empty")}
            </Text>
          </View>
        ) : (
          <View style={[s.card, d.card]}>
            {orderedSessions.map((session, index) => (
              <View key={session.id}>
                <View style={s.row}>
                  <View style={[s.iconBox, d.iconBox]}>
                    <Ionicons name={getDeviceIcon(session)} size={18} color={colors.iconAccent} />
                  </View>
                  <View style={s.titleBlock}>
                    <View style={s.titleLine}>
                      <Text style={[s.titleText, d.title]} numberOfLines={1}>
                        {getDeviceTitle(
                          session,
                          t(
                            "settingsDetails.accountSecurity.deviceManagement.unknownDevice",
                          ),
                        )}
                      </Text>
                      {session.isCurrent ? (
                        <View style={[s.badge, d.badge]}>
                          <Text style={d.badgeText}>
                            {t(
                              "settingsDetails.accountSecurity.deviceManagement.current",
                            )}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={d.caption}>
                      {formatDate(
                        session.lastUsedAt,
                        t(
                          "settingsDetails.accountSecurity.deviceManagement.unknownTime",
                        ),
                      )}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      session.isCurrent
                        ? t("settingsDetails.accountSecurity.deviceManagement.logoutCurrent")
                        : t("settingsDetails.accountSecurity.deviceManagement.remove")
                    }
                    style={({ pressed }) => [s.button, d.button, pressed ? s.pressed : null]}
                    disabled={submittingId !== null}
                    onPress={() => confirmRevokeSession(session)}
                  >
                    {submittingId === session.id ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <Text style={d.buttonText}>
                        {session.isCurrent
                          ? t(
                              "settingsDetails.accountSecurity.deviceManagement.logoutCurrent",
                            )
                          : t(
                              "settingsDetails.accountSecurity.deviceManagement.remove",
                            )}
                      </Text>
                    )}
                  </Pressable>
                </View>
                {index < orderedSessions.length - 1 ? (
                  <View style={s.dividerInset}>
                    <Divider />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
        {error ? <Text style={d.error}>{error}</Text> : null}
        <Pressable
          style={[
            s.footerButton,
            d.footerButton,
            !hasOtherSessions || submittingId !== null
              ? d.footerButtonDisabled
              : null,
          ]}
          disabled={!hasOtherSessions || submittingId !== null}
          onPress={handleLogoutOthers}
        >
          <Text style={d.footerButtonText}>
            {t("settingsDetails.accountSecurity.deviceManagement.logoutOthers")}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
