import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { OptionPickerSheet, type PickerOption } from '@/components/ui/option-picker-sheet';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import {
  fetchPrivacySettings,
  type MomentsVisibility,
  type PrivacyPermission,
  type PrivacySettings,
  updatePrivacySettings,
  type UpdatePrivacySettingsPayload,
} from '@/services/api/privacy';
import { getApiErrorMessage } from '@/services/api/errors';
import { isDefinitiveAuthFailure } from '@/services/api/client';
import {
  BURN_DURATION_CHOICES,
  BURN_DURATION_OFF,
  formatBurnDuration,
  type BurnDurationSec,
} from '@/chat-core/burn-durations';
import {
  useChatStore,
  viewerTypingPolicyFromPrivacy,
} from '@/chat-core/store';
import {
  readPrivacySettingsCache,
} from '@/features/profile/privacy-settings-cache';
import { useAuthStore } from '@/stores/authStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

type ActiveSheet =
  | 'self-destruct'
  | 'moments-visibility'
  | 'add-me-methods'
  | 'call-permission'
  | 'group-invite-permission'
  | null;

const s = StyleSheet.create({
  footer: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    textAlign: 'center',
  },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.xs,
  },
  sheetTitle: {
    ...Typography.h3,
  },
  methodRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  methodLabel: {
    ...Typography.body,
  },
});

// 全局档位就是会话级那张表 —— 这个开关和聊天信息页的「阅后即焚」是同一个功能,
// 各挑各的档位只会让用户以为它们是两回事。
const SELF_DESTRUCT_OPTIONS: readonly BurnDurationSec[] = BURN_DURATION_CHOICES;
const MOMENTS_OPTIONS: readonly MomentsVisibility[] = [
  'ALL',
  'FRIENDS_ONLY',
  'PRIVATE',
];
const PERMISSION_OPTIONS: readonly PrivacyPermission[] = [
  'EVERYONE',
  'FRIENDS_ONLY',
  'NONE',
];

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  // 与后端 DEFAULT_PRIVACY_SETTINGS 对齐:0 = 关闭阅后即焚。
  messageSelfDestructSec: BURN_DURATION_OFF,
  momentsVisibility: 'ALL',
  allowStrangerMessages: true,
  showPhone: false,
  // 与后端 DEFAULT_PRIVACY_SETTINGS 对齐：邮箱跟手机号同档，默认不外露。
  showEmail: false,
  showWechat: true,
  showQQ: true,
  // 无对应开关：whatsup 字段本身在 App 里还没有界面（见 privacy.ts 的说明）。
  showWhatsup: true,
  addMeByAccount: true,
  addMeByPhone: false,
  addMeByQrCode: true,
  addMeByGroup: true,
  callPermission: 'EVERYONE',
  groupInvitePermission: 'EVERYONE',
  allowFriendGroupDirectJoin: false,
  // 与后端 DEFAULT_PRIVACY_SETTINGS 对齐:在线状态与输入状态默认外露。
  shareOnlineStatus: true,
  shareTypingInDirect: true,
  shareTypingInGroup: true,
};

export default function PrivacySettingsScreen() {
  const sessionKey = useAuthStore((state) => state.user?.id ? `${state.user.id}:${state.sessionEpoch}` : null);
  return sessionKey ? <PrivacySettingsContent key={sessionKey} /> : null;
}

function PrivacySettingsContent() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  // 先画这个账号上次拿到的真实设置,没有才退回默认值;后台照常重拉,拉完之前仍不可拨。
  const [settings, setSettings] = useState<PrivacySettings | null>(() =>
    readPrivacySettingsCache(sessionEpoch),
  );
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const privacyRequestSequence = useRef(0);
  const savingRequest = useRef<number | null>(null);

  const currentSettings = settings ?? DEFAULT_PRIVACY_SETTINGS;
  const controlsDisabled = loading || !loaded || saving;

  const d = useMemo(
    () => ({
      error: { color: colors.error, ...Typography.caption },
      sheet: { backgroundColor: colors.surface },
      sheetHandle: { backgroundColor: colors.surfaceBorder },
      sheetTitle: { color: colors.text },
      methodLabel: { color: colors.text },
    }),
    [colors],
  );

  const loadSettings = useCallback(async () => {
    const request = ++privacyRequestSequence.current;
    const isCurrent = () => request === privacyRequestSequence.current &&
      useAuthStore.getState().sessionEpoch === sessionEpoch;
    setLoading(true);
    setError(null);
    try {
      const loaded = await fetchPrivacySettings();
      if (!isCurrent()) return;
      setSettings(loaded);
      setLoaded(true);
      // 服务端不下发全局阅后即焚的开启时间：store 在档位变化时记本机观察到的时刻。
      if (useChatStore.getState().viewerSelfDestructSec !== loaded.messageSelfDestructSec) {
        useChatStore.getState().setViewerSelfDestructSec(loaded.messageSelfDestructSec);
      }
      useChatStore
        .getState()
        .setViewerTypingPolicy(viewerTypingPolicyFromPrivacy(loaded));
    } catch (requestError) {
      if (!isCurrent()) return;
      if (isDefinitiveAuthFailure(requestError)) {
        setSettings(null);
        setLoaded(false);
      }
      setError(
        getApiErrorMessage(
          requestError,
          t('settingsDetails.privacy.loadFailed'),
        ),
      );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [sessionEpoch, t]);

  useEffect(() => {
    setSettings(readPrivacySettingsCache(sessionEpoch));
    setLoaded(false);
    setSaving(false);
    setActiveSheet(null);
    void loadSettings();
    return () => {
      privacyRequestSequence.current += 1;
      savingRequest.current = null;
    };
  }, [loadSettings, sessionEpoch]);

  async function patchSettings(payload: UpdatePrivacySettingsPayload) {
    if (controlsDisabled || savingRequest.current !== null ||
      useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
    const request = ++privacyRequestSequence.current;
    savingRequest.current = request;
    setSaving(true);
    const isCurrent = () => request === privacyRequestSequence.current &&
      useAuthStore.getState().sessionEpoch === sessionEpoch;
    const previous = currentSettings;
    const next = { ...previous, ...payload };
    setSettings(next);
    setError(null);
    try {
      const updated = await updatePrivacySettings(payload);
      // A confirmed save still applies to this session after the user leaves this screen.
      if (useAuthStore.getState().sessionEpoch !== sessionEpoch) return;
      // 服务端不下发全局阅后即焚的开启时间：store 在档位变化时记本机观察到的时刻。
      if (payload.messageSelfDestructSec !== undefined &&
        useChatStore.getState().viewerSelfDestructSec !== updated.messageSelfDestructSec) {
        useChatStore.getState().setViewerSelfDestructSec(updated.messageSelfDestructSec);
      }
      // 输入状态开关的门禁在 socket-manager 里读 chat store,这里保存后立刻同步。
      useChatStore
        .getState()
        .setViewerTypingPolicy(viewerTypingPolicyFromPrivacy(updated));
      if (!isCurrent()) return;
      setSettings(updated);
      if ((Object.keys(payload) as (keyof PrivacySettings)[]).some((key) => updated[key] === undefined)) {
        setError(t('settingsDetails.privacy.saveFailed'));
      }
    } catch (requestError) {
      if (!isCurrent()) return;
      if (isDefinitiveAuthFailure(requestError)) {
        setSettings(null);
        setLoaded(false);
      } else setSettings(previous);
      setError(
        getApiErrorMessage(
          requestError,
          t('settingsDetails.privacy.saveFailed'),
        ),
      );
    } finally {
      if (isCurrent()) setSaving(false);
      if (savingRequest.current === request) savingRequest.current = null;
    }
  }

  const selfDestructOptions = useMemo<PickerOption<BurnDurationSec>[]>(
    () =>
      SELF_DESTRUCT_OPTIONS.map((value) => ({
        value,
        label: selfDestructLabel(value, t),
      })),
    [t],
  );
  const momentsOptions = useMemo<PickerOption<MomentsVisibility>[]>(
    () =>
      MOMENTS_OPTIONS.map((value) => ({
        value,
        label: privacyEnumLabel('moments', value, t),
      })),
    [t],
  );
  const permissionOptions = useMemo<PickerOption<PrivacyPermission>[]>(
    () =>
      PERMISSION_OPTIONS.map((value) => ({
        value,
        label: privacyEnumLabel('permission', value, t),
      })),
    [t],
  );

  // 只统计界面上真正可配置的开关。名片分享是一个动作入口，不是服务端独立
  // 的隐私字段，因此不会重复计入已开启数量。
  const addMeCount = [
    currentSettings.addMeByAccount,
    currentSettings.addMeByQrCode,
    currentSettings.addMeByGroup,
  ].filter(Boolean).length;

  return (
    <>
      <SettingsDetailScreen
        testIDPrefix="privacy"
        dimDisabledRows={false}
        titleKey="settingsDetails.privacy.title"
        header={
          <View style={s.footer}>
            {(loading && settings === null) || saving ? (
              <ActivityIndicator
                testID={saving ? 'privacy-saving' : undefined}
                accessibilityLabel={saving ? t('common.saving') : undefined}
                color={colors.primary}
              />
            ) : null}
            {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}
            {error && !loaded && !loading ? (
              <Pressable onPress={() => void loadSettings()} accessibilityRole="button">
                <Text style={{ color: colors.primary }}>{t('common.retry')}</Text>
              </Pressable>
            ) : null}
          </View>
        }
        sections={[
          {
            rows: [
              {
                id: 'self-destruct',
                labelKey: 'settingsDetails.privacy.selfDestruct',
                valueText: selfDestructLabel(
                  currentSettings.messageSelfDestructSec,
                  t,
                ),
                onPress: () => setActiveSheet('self-destruct'),
                disabled: controlsDisabled,
              },
              {
                id: 'blacklist',
                labelKey: 'settingsDetails.privacy.blacklist',
                onPress: () => router.push('/(tabs)/profile/settings-blacklist'),
              },
              {
                id: 'moments-visibility',
                labelKey: 'settingsDetails.privacy.momentsVisibility',
                valueText: privacyEnumLabel(
                  'moments',
                  currentSettings.momentsVisibility,
                  t,
                ),
                onPress: () => setActiveSheet('moments-visibility'),
                disabled: controlsDisabled,
              },
              {
                id: 'stranger-message',
                labelKey: 'settingsDetails.privacy.strangerMessage',
                type: 'toggle',
                value: currentSettings.allowStrangerMessages,
                onValueChange: (value) =>
                  void patchSettings({ allowStrangerMessages: value }),
                disabled: controlsDisabled,
              },
            ],
          },
          {
            rows: [
              {
                id: 'online-time',
                labelKey: 'settingsDetails.privacy.onlineTime',
                type: currentSettings.shareOnlineStatus === undefined ? 'info' : 'toggle',
                value: currentSettings.shareOnlineStatus,
                valueText: currentSettings.shareOnlineStatus === undefined ? t('settingsDetails.privacy.unavailable') : undefined,
                subtitleKey: currentSettings.shareOnlineStatus === undefined ? 'settingsDetails.privacy.unsupportedHint' : undefined,
                onValueChange: (value) =>
                  void patchSettings({ shareOnlineStatus: value }),
                disabled: controlsDisabled || currentSettings.shareOnlineStatus === undefined,
              },
              {
                id: 'single-typing',
                labelKey: 'settingsDetails.privacy.singleTyping',
                type: currentSettings.shareTypingInDirect === undefined ? 'info' : 'toggle',
                value: currentSettings.shareTypingInDirect,
                valueText: currentSettings.shareTypingInDirect === undefined ? t('settingsDetails.privacy.unavailable') : undefined,
                subtitleKey: currentSettings.shareTypingInDirect === undefined ? 'settingsDetails.privacy.unsupportedHint' : undefined,
                onValueChange: (value) =>
                  void patchSettings({ shareTypingInDirect: value }),
                disabled: controlsDisabled || currentSettings.shareTypingInDirect === undefined,
              },
              {
                id: 'group-typing',
                labelKey: 'settingsDetails.privacy.groupTyping',
                type: currentSettings.shareTypingInGroup === undefined ? 'info' : 'toggle',
                value: currentSettings.shareTypingInGroup,
                valueText: currentSettings.shareTypingInGroup === undefined ? t('settingsDetails.privacy.unavailable') : undefined,
                subtitleKey: currentSettings.shareTypingInGroup === undefined ? 'settingsDetails.privacy.unsupportedHint' : undefined,
                onValueChange: (value) =>
                  void patchSettings({ shareTypingInGroup: value }),
                disabled: controlsDisabled || currentSettings.shareTypingInGroup === undefined,
              },
            ],
          },
          {
            rows: [
              {
                id: 'show-phone',
                labelKey: 'settingsDetails.privacy.showPhone',
                type: 'toggle',
                value: currentSettings.showPhone,
                onValueChange: (value) => void patchSettings({ showPhone: value }),
                disabled: controlsDisabled,
              },
              {
                id: 'show-email',
                labelKey: 'settingsDetails.privacy.showEmail',
                type: 'toggle',
                value: currentSettings.showEmail,
                onValueChange: (value) =>
                  void patchSettings({ showEmail: value }),
                disabled: controlsDisabled,
              },
              {
                id: 'show-wechat',
                labelKey: 'settingsDetails.privacy.showWechat',
                type: 'toggle',
                value: currentSettings.showWechat,
                onValueChange: (value) =>
                  void patchSettings({ showWechat: value }),
                disabled: controlsDisabled,
              },
              {
                id: 'show-qq',
                labelKey: 'settingsDetails.privacy.showQQ',
                type: 'toggle',
                value: currentSettings.showQQ,
                onValueChange: (value) => void patchSettings({ showQQ: value }),
                disabled: controlsDisabled,
              },
            ],
          },
          {
            rows: [
              {
                id: 'add-me-methods',
                labelKey: 'settingsDetails.privacy.addMeMethods',
                valueText: t('settingsDetails.privacy.enabledCount', {
                  count: addMeCount,
                }),
                onPress: () => setActiveSheet('add-me-methods'),
                disabled: controlsDisabled,
              },
              {
                id: 'call-permission',
                labelKey: 'settingsDetails.privacy.callPermission',
                valueText: privacyEnumLabel(
                  'permission',
                  currentSettings.callPermission,
                  t,
                ),
                onPress: () => setActiveSheet('call-permission'),
                disabled: controlsDisabled,
              },
              {
                id: 'group-invite-permission',
                labelKey: 'settingsDetails.privacy.groupInvitePermission',
                valueText: privacyEnumLabel(
                  'permission',
                  currentSettings.groupInvitePermission,
                  t,
                ),
                onPress: () => setActiveSheet('group-invite-permission'),
                disabled: controlsDisabled,
              },
              {
                id: 'friend-group-direct-join',
                labelKey: 'settingsDetails.privacy.allowFriendGroupDirectJoin',
                type: 'toggle',
                value: currentSettings.allowFriendGroupDirectJoin ?? false,
                onValueChange: (value) =>
                  void patchSettings({ allowFriendGroupDirectJoin: value }),
                disabled: controlsDisabled,
              },
            ],
          },
        ]}
      />
      <OptionPickerSheet
        visible={activeSheet === 'self-destruct'}
        title={t('settingsDetails.privacy.selfDestruct')}
        options={selfDestructOptions}
        selectedValue={currentSettings.messageSelfDestructSec}
        onSelect={(value) => void patchSettings({ messageSelfDestructSec: value })}
        onClose={() => setActiveSheet(null)}
      />
      <OptionPickerSheet
        visible={activeSheet === 'moments-visibility'}
        title={t('settingsDetails.privacy.momentsVisibility')}
        options={momentsOptions}
        selectedValue={currentSettings.momentsVisibility}
        onSelect={(value) => void patchSettings({ momentsVisibility: value })}
        onClose={() => setActiveSheet(null)}
      />
      <OptionPickerSheet
        visible={activeSheet === 'call-permission'}
        title={t('settingsDetails.privacy.callPermission')}
        options={permissionOptions}
        selectedValue={currentSettings.callPermission}
        onSelect={(value) => void patchSettings({ callPermission: value })}
        onClose={() => setActiveSheet(null)}
      />
      <OptionPickerSheet
        visible={activeSheet === 'group-invite-permission'}
        title={t('settingsDetails.privacy.groupInvitePermission')}
        options={permissionOptions}
        selectedValue={currentSettings.groupInvitePermission}
        onSelect={(value) => void patchSettings({ groupInvitePermission: value })}
        onClose={() => setActiveSheet(null)}
      />
      <AddMeMethodsSheet
        visible={activeSheet === 'add-me-methods'}
        settings={currentSettings}
        disabled={controlsDisabled}
        onClose={() => setActiveSheet(null)}
        onChange={(payload) => void patchSettings(payload)}
        onShareCard={() => {
          setActiveSheet(null);
          router.push({ pathname: '/qr-code', params: { type: 'user' } });
        }}
      />
    </>
  );
}

function selfDestructLabel(
  value: BurnDurationSec,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (value === BURN_DURATION_OFF) {
    return t('settingsDetails.privacy.selfDestructOff');
  }
  return formatBurnDuration(value);
}

function privacyEnumLabel(
  type: 'moments' | 'permission',
  value: MomentsVisibility | PrivacyPermission,
  t: (key: string) => string,
) {
  return t(`settingsDetails.privacy.${type}.${value}`);
}

function AddMeMethodsSheet({
  visible,
  settings,
  disabled,
  onClose,
  onChange,
  onShareCard,
}: {
  visible: boolean;
  settings: PrivacySettings;
  disabled: boolean;
  onClose: () => void;
  onChange: (payload: UpdatePrivacySettingsPayload) => void;
  onShareCard: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      title: { color: colors.text },
      label: { color: colors.text },
    }),
    [colors],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      backdropStyle={d.backdrop}
      sheetStyle={[s.sheet, d.sheet]}
    >
      <View style={[s.sheetHandle, d.handle]} />
      <Text style={[s.sheetTitle, d.title]}>
        {t('settingsDetails.privacy.addMeMethods')}
      </Text>
      <MethodSwitch
        label={t('settingsDetails.privacy.addMe.byAccount')}
        value={settings.addMeByAccount}
        disabled={disabled}
        onValueChange={(value) => onChange({ addMeByAccount: value })}
      />
      <MethodSwitch
        label={t('settingsDetails.privacy.addMe.byQrCode')}
        value={settings.addMeByQrCode}
        disabled={disabled}
        onValueChange={(value) => onChange({ addMeByQrCode: value })}
      />
      <MethodSwitch
        label={t('settingsDetails.privacy.addMe.byGroup')}
        value={settings.addMeByGroup}
        disabled={disabled}
        onValueChange={(value) => onChange({ addMeByGroup: value })}
      />
      <MethodAction
        label={t('settingsDetails.privacy.addMe.shareCard')}
        disabled={disabled}
        onPress={onShareCard}
      />
    </BottomSheetModal>
  );
}

function MethodSwitch({
  label,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={s.methodRow}>
      <Text style={[s.methodLabel, { color: colors.text }]}>{label}</Text>
      <ThemedSwitch
        tint={colors.primary}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
      />
    </View>
  );
}

function MethodAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [s.methodRow, pressed && { opacity: 0.7 }]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[s.methodLabel, { color: colors.text }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}
