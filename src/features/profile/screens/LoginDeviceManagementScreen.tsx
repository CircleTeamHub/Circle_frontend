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

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  badge: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.md,
  },
  button: {
    minHeight: 40,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
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
        fontWeight: "700" as const,
      },
      caption: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      badge: {
        backgroundColor: colors.primary,
      },
      badgeText: {
        color: colors.white,
        ...Typography.caption,
        fontWeight: "700" as const,
      },
      button: {
        borderWidth: 1,
        borderColor: colors.error,
      },
      buttonText: {
        color: colors.error,
        ...Typography.caption,
        fontWeight: "700" as const,
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

  async function revokeSession(session: AuthSession) {
    setSubmittingId(session.id);
    setError(null);
    try {
      await revokeAuthSession(session.id);
      if (session.isCurrent) {
        await clearLocalSession();
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
            tintColor={colors.primary}
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
          sessions.map((session) => (
            <View key={session.id} style={[s.card, d.card]}>
              <View style={s.titleRow}>
                <View style={s.titleBlock}>
                  <Text style={d.title}>
                    {getDeviceTitle(
                      session,
                      t(
                        "settingsDetails.accountSecurity.deviceManagement.unknownDevice",
                      ),
                    )}
                  </Text>
                  <Text style={d.caption}>
                    {formatDate(
                      session.lastUsedAt,
                      t(
                        "settingsDetails.accountSecurity.deviceManagement.unknownTime",
                      ),
                    )}
                  </Text>
                </View>
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
              <View style={s.actions}>
                <Pressable
                  style={[s.button, d.button]}
                  disabled={submittingId !== null}
                  onPress={() => confirmRevokeSession(session)}
                >
                  <Text style={d.buttonText}>
                    {session.isCurrent
                      ? t(
                          "settingsDetails.accountSecurity.deviceManagement.logoutCurrent",
                        )
                      : t(
                          "settingsDetails.accountSecurity.deviceManagement.remove",
                        )}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
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
