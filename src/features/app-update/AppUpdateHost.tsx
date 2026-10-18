import { useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Button,
  Linking,
  Modal,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import {
  checkForManagedUpdate,
  type ManagedUpdate,
} from "./managed-update-service";
import { downloadAndInstallAndroidUpdate } from "./app-update-service";
import { reportHandledFailure } from "@/observability/report-failure";

export function AppUpdateHost() {
  const { t } = useTranslation();
  const [required, setRequired] = useState<ManagedUpdate | null>(null),
    [installing, setInstalling] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true,
      inFlight = false,
      lastCheck = 0,
      promptedVersion = "";
    const install = async (update: ManagedUpdate) => {
      try {
        if (update.platform === "android" && update.manifest)
          await downloadAndInstallAndroidUpdate(update.manifest);
        else await Linking.openURL(update.url);
      } catch (error) {
        reportHandledFailure("appUpdate", "install", error);
        if (active)
          Alert.alert(
            t("appUpdate.installFailedTitle"),
            t("appUpdate.installFailedMessage"),
          );
      }
    };
    const check = async () => {
      if (inFlight || Date.now() - lastCheck < 60_000) return;
      inFlight = true;
      try {
        const update = await checkForManagedUpdate();
        if (!active) return;
        lastCheck = Date.now();
        setRequired(update?.mandatory ? update : null);
        if (update && !update.mandatory && promptedVersion !== update.version) {
          promptedVersion = update.version;
          Alert.alert(
            t("appUpdate.availableTitle"),
            t("appUpdate.availableMessage", { version: update.version }),
            [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("appUpdate.updateNow"),
                onPress: () => {
                  void install(update);
                },
              },
            ],
          );
        }
      } catch (error) {
        reportHandledFailure("appUpdate", "check", error);
      } finally {
        inFlight = false;
      }
    };
    void check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [t]);
  const installRequired = async () => {
    if (!required || installing) return;
    setInstalling(true);
    setFailed(false);
    try {
      if (required.platform === "android" && required.manifest)
        await downloadAndInstallAndroidUpdate(required.manifest);
      else await Linking.openURL(required.url);
    } catch (error) {
      setFailed(true);
      reportHandledFailure("appUpdate", "install", error);
    } finally {
      setInstalling(false);
    }
  };
  return (
    <Modal
      visible={!!required}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 24,
          backgroundColor: "rgba(0,0,0,0.6)",
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            padding: 24,
            borderRadius: 16,
            backgroundColor: "#fff",
            gap: 16,
          }}
        >
          <Text style={{ fontSize: 22, fontWeight: "600", color: "#111" }}>
            {t("appUpdate.requiredTitle", { defaultValue: "请更新后继续使用" })}
          </Text>
          <Text style={{ color: "#333" }}>
            {t("appUpdate.availableMessage", { version: required?.version })}
          </Text>
          {failed && (
            <Text accessibilityRole="alert" style={{ color: "#b00020" }}>
              {t("appUpdate.installFailedMessage")}
            </Text>
          )}
          <Button
            title={installing ? t("common.loading") : t("appUpdate.updateNow")}
            disabled={installing}
            onPress={() => void installRequired()}
          />
        </View>
      </View>
    </Modal>
  );
}
