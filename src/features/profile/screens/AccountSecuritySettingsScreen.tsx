import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { SettingsDetailScreen } from "@/features/profile/components/settings-detail";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchLoginSecurityCodeStatus,
  fetchSecurityQuestions,
  fetchSingleDeviceLoginStatus,
  setSingleDeviceLogin,
} from "@/services/api/auth";
import { reportHandledFailure } from '@/observability/report-failure';

const SECURITY_CODE_ROUTE = "/(tabs)/profile/change-security-code" as const;

export default function AccountSecuritySettingsScreen() {
  const router = useRouter();
  const { logout, switchAccount, submitting } = useAuth();
  const [singleDeviceLogin, setSingleDeviceLoginValue] = useState(false);
  const [singleDeviceLoading, setSingleDeviceLoading] = useState(true);
  const [singleDeviceSubmitting, setSingleDeviceSubmitting] = useState(false);
  const singleDeviceInFlightRef = useRef(false);

  const [securityCodeEnabled, setSecurityCodeEnabled] = useState(false);
  const [securityCodeLoading, setSecurityCodeLoading] = useState(true);
  const [securityCodeError, setSecurityCodeError] = useState(false);
  const securityCodeRequestRef = useRef(0);

  const loadSecurityCodeStatus = useCallback(async () => {
    const requestId = securityCodeRequestRef.current + 1;
    securityCodeRequestRef.current = requestId;
    setSecurityCodeLoading(true);
    setSecurityCodeError(false);

    try {
      const status = await fetchLoginSecurityCodeStatus();
      if (securityCodeRequestRef.current !== requestId) return;
      setSecurityCodeEnabled(status.enabled);
    } catch (requestError) {
      if (securityCodeRequestRef.current !== requestId) return;
      // 拿不到状态时不静默当作「未开启」——置为错误态并禁用开关，避免误导用户。
      setSecurityCodeError(true);
      reportHandledFailure("securityCode", "statusCheck", requestError);
    } finally {
      if (securityCodeRequestRef.current === requestId) {
        setSecurityCodeLoading(false);
      }
    }
  }, []);

  // null = 还不知道（加载中 / 拉取失败），行尾不显示状态。
  const [securityQuestionsSet, setSecurityQuestionsSet] = useState<boolean | null>(null);
  const securityQuestionsRequestRef = useRef(0);
  const loadSecurityQuestionsStatus = useCallback(async () => {
    // 每次聚焦都会重拉：只认最后一次请求，晚到的旧响应不覆盖新状态。
    const requestId = securityQuestionsRequestRef.current + 1;
    securityQuestionsRequestRef.current = requestId;
    try {
      const keys = await fetchSecurityQuestions();
      if (securityQuestionsRequestRef.current === requestId) {
        setSecurityQuestionsSet(keys.length > 0);
      }
    } catch (requestError) {
      // 刷新失败就不再显示上一次的结论（可能已经过时），回到「不知道」。
      if (securityQuestionsRequestRef.current === requestId) {
        setSecurityQuestionsSet(null);
      }
      reportHandledFailure("securityQuestions", "statusCheck", requestError);
    }
  }, []);

  // 每次回到本页都重新拉取：从设置/修改/关闭子页返回后开关状态保持同步。
  useFocusEffect(
    useCallback(() => {
      void loadSecurityCodeStatus();
      void loadSecurityQuestionsStatus();
    }, [loadSecurityCodeStatus, loadSecurityQuestionsStatus]),
  );

  function handleSecurityCodeToggle(next: boolean) {
    if (securityCodeLoading || securityCodeError) return;
    // 开启/关闭都需要输入安全码，跳到对应子页完成，回来后由 useFocusEffect 刷新开关。
    router.push({
      pathname: SECURITY_CODE_ROUTE,
      params: { mode: next ? "enable" : "disable" },
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSingleDeviceLogin() {
      try {
        const status = await fetchSingleDeviceLoginStatus();
        if (!cancelled) {
          setSingleDeviceLoginValue(status.enabled);
        }
      } catch (requestError) {
        if (!cancelled) {
          reportHandledFailure("singleDeviceLogin", "statusCheck", requestError);
        }
      } finally {
        if (!cancelled) {
          setSingleDeviceLoading(false);
        }
      }
    }

    void loadSingleDeviceLogin();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSingleDeviceLoginChange(value: boolean) {
    if (singleDeviceInFlightRef.current) return;

    const previousValue = singleDeviceLogin;
    singleDeviceInFlightRef.current = true;
    setSingleDeviceLoginValue(value);
    setSingleDeviceSubmitting(true);
    try {
      await setSingleDeviceLogin(value);
    } catch (requestError) {
      setSingleDeviceLoginValue(previousValue);
      reportHandledFailure("singleDeviceLogin", "update", requestError);
    } finally {
      singleDeviceInFlightRef.current = false;
      setSingleDeviceSubmitting(false);
    }
  }

  return (
    <SettingsDetailScreen
      titleKey="settingsDetails.accountSecurity.title"
      sections={[
        {
          titleKey: "settingsDetails.accountSecurity.credentialSection",
          rows: [
            {
              id: "change-password",
              labelKey: "settingsDetails.accountSecurity.changePassword",
              onPress: () =>
                router.push("/(tabs)/profile/change-password" as never),
            },
            {
              id: "enable-security-code",
              labelKey: "settingsDetails.accountSecurity.enableLoginSecurityCode",
              type: "toggle",
              value: securityCodeEnabled,
              disabled: securityCodeLoading || securityCodeError,
              subtitleKey: securityCodeError
                ? "profile.securityCodeStatusFailed"
                : undefined,
              onValueChange: handleSecurityCodeToggle,
            },
            {
              id: "change-security-code",
              labelKey: "settingsDetails.accountSecurity.changeLoginSecurityCode",
              valueKey: "settingsDetails.accountSecurity.securityCodeHint",
              // 修改与开启状态无关，始终可点
              onPress: () =>
                router.push({
                  pathname: SECURITY_CODE_ROUTE,
                  params: { mode: "change" },
                }),
            },
            {
              id: "security-questions",
              labelKey: "settingsDetails.accountSecurity.securityQuestions",
              valueKey:
                securityQuestionsSet === null
                  ? undefined
                  : securityQuestionsSet
                    ? "settingsDetails.accountSecurity.securityQuestionsSet"
                    : "settingsDetails.accountSecurity.securityQuestionsNotSet",
              onPress: () =>
                router.push("/(tabs)/profile/security-questions" as never),
            },
          ],
        },
        {
          titleKey: "settingsDetails.accountSecurity.loginSecuritySection",
          rows: [
            {
              id: "single-device-login",
              labelKey: "settingsDetails.accountSecurity.singleDeviceLogin",
              type: "toggle",
              value: singleDeviceLogin,
              disabled: singleDeviceLoading || singleDeviceSubmitting,
              onValueChange: handleSingleDeviceLoginChange,
            },
            {
              id: "login-device-management",
              labelKey: "settingsDetails.accountSecurity.loginDeviceManagement",
              onPress: () =>
                router.push("/(tabs)/profile/login-devices" as never),
            },
          ],
        },
        {
          titleKey: "settingsDetails.accountSecurity.accountActionsSection",
          rows: [
            {
              id: "switch-account",
              labelKey: "settingsDetails.accountSecurity.switchAccount",
              disabled: submitting,
              onPress: switchAccount,
            },
            {
              id: "logout",
              labelKey: "settingsDetails.accountSecurity.logout",
              destructive: true,
              disabled: submitting,
              onPress: logout,
            },
            {
              id: "cancel-account",
              labelKey: "settingsDetails.accountSecurity.cancelAccount",
              destructive: true,
            },
          ],
        },
      ]}
    />
  );
}
