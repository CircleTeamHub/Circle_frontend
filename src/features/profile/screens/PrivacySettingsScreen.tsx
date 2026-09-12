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
  messageSelfDestructStartedAt: null,
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
  // 与后端 DEFAULT_PRIVACY_SETTINGS 对齐:在线状态与输入状态默认外露。
  shareOnlineStatus: true,
  shareTypingInDirect: true,
  shareTypingInGroup: true,
};

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const privacyRequestSequence = useRef(0);

  const currentSettings = settings ?? DEFAULT_PRIVACY_SETTINGS;

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
    const chatUserId = useChatStore.getState().currentUserId;
    setLoading(true);
    setError(null);
    try {
      const loaded = await fetchPrivacySettings();
      if (
        request !== privacyRequestSequence.current ||
        useChatStore.getState().currentUserId !== chatUserId
      ) {
        return;
      }
      setSettings(loaded);
      useChatStore
        .getState()
        .setViewerSelfDestructSec(
          loaded.messageSelfDestructSec,
          undefined,
          loaded.messageSelfDestructStartedAt,
        );
      useChatStore
        .getState()
        .setViewerTypingPolicy(viewerTypingPolicyFromPrivacy(loaded));
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          t('settingsDetails.privacy.loadFailed'),
        ),
      );
    } finally {
      if (request === privacyRequestSequence.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function patchSettings(payload: UpdatePrivacySettingsPayload) {
    const request = ++privacyRequestSequence.current;
    const chatUserId = useChatStore.getState().currentUserId;
    const previous = currentSettings;
    const next = { ...previous, ...payload };
    setSettings(next);
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePrivacySettings(payload);
      if (
        request !== privacyRequestSequence.current ||
        useChatStore.getState().currentUserId !== chatUserId
      ) {
        return;
      }
      setSettings(updated);
      useChatStore
        .getState()
        .setViewerSelfDestructSec(
          updated.messageSelfDestructSec,
          undefined,
          updated.messageSelfDestructStartedAt,
        );
      // 输入状态开关的门禁在 socket-manager 里读 chat store,这里保存后立刻同步。
      useChatStore
        .getState()
        .setViewerTypingPolicy(viewerTypingPolicyFromPrivacy(updated));
    } catch (requestError) {
      if (
        request !== privacyRequestSequence.current ||
        useChatStore.getState().currentUserId !== chatUserId
      ) {
        return;
      }
      setSettings(previous);
      setError(
        getApiErrorMessage(
          requestError,
          t('settingsDetails.privacy.saveFailed'),
        ),
      );
    } finally {
      if (request === privacyRequestSequence.current) setSaving(false);
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
        titleKey="settingsDetails.privacy.title"
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
                disabled: loading || saving,
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
                disabled: loading || saving,
              },
              {
                id: 'stranger-message',
                labelKey: 'settingsDetails.privacy.strangerMessage',
                type: 'toggle',
                value: currentSettings.allowStrangerMessages,
                onValueChange: (value) =>
                  void patchSettings({ allowStrangerMessages: value }),
                disabled: loading || saving,
              },
            ],
          },
          {
            rows: [
              {
                id: 'online-time',
                labelKey: 'settingsDetails.privacy.onlineTime',
                type: 'toggle',
                // 滚动发布期间旧服务端不返回这三项,缺省按 true(与后端默认一致)。
                value: currentSettings.shareOnlineStatus ?? true,
                onValueChange: (value) =>
                  void patchSettings({ shareOnlineStatus: value }),
                disabled: loading || saving,
              },
              {
                id: 'single-typing',
                labelKey: 'settingsDetails.privacy.singleTyping',
                type: 'toggle',
                value: currentSettings.shareTypingInDirect ?? true,
                onValueChange: (value) =>
                  void patchSettings({ shareTypingInDirect: value }),
                disabled: loading || saving,
              },
              {
                id: 'group-typing',
                labelKey: 'settingsDetails.privacy.groupTyping',
                type: 'toggle',
                value: currentSettings.shareTypingInGroup ?? true,
                onValueChange: (value) =>
                  void patchSettings({ shareTypingInGroup: value }),
                disabled: loading || saving,
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
                disabled: loading || saving,
              },
              {
                id: 'show-email',
                labelKey: 'settingsDetails.privacy.showEmail',
                type: 'toggle',
                value: currentSettings.showEmail,
                onValueChange: (value) =>
                  void patchSettings({ showEmail: value }),
                disabled: loading || saving,
              },
              {
                id: 'show-wechat',
                labelKey: 'settingsDetails.privacy.showWechat',
                type: 'toggle',
                value: currentSettings.showWechat,
                onValueChange: (value) =>
                  void patchSettings({ showWechat: value }),
                disabled: loading || saving,
              },
              {
                id: 'show-qq',
                labelKey: 'settingsDetails.privacy.showQQ',
                type: 'toggle',
                value: currentSettings.showQQ,
                onValueChange: (value) => void patchSettings({ showQQ: value }),
                disabled: loading || saving,
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
                disabled: loading || saving,
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
                disabled: loading || saving,
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
                disabled: loading || saving,
              },
            ],
          },
        ]}
        footer={
          <View style={s.footer}>
            {loading ? <ActivityIndicator color={colors.primary} /> : null}
            {error ? <Text style={[s.error, d.error]}>{error}</Text> : null}
          </View>
        }
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
        disabled={loading || saving}
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
