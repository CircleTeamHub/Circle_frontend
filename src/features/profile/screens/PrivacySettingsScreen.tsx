import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { OptionPickerSheet, type PickerOption } from '@/components/ui/option-picker-sheet';
import { SettingsDetailScreen } from '@/features/profile/components/settings-detail';
import {
  fetchPrivacySettings,
  type MomentsVisibility,
  type PrivacyPermission,
  type PrivacySettings,
  type SelfDestructDays,
  updatePrivacySettings,
  type UpdatePrivacySettingsPayload,
} from '@/services/api/privacy';
import { getApiErrorMessage } from '@/services/api/errors';
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

const SELF_DESTRUCT_OPTIONS: readonly SelfDestructDays[] = [0, 1, 2, 7, 30];
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
  // 与后端 DEFAULT_PRIVACY_SETTINGS 对齐:0 = 关闭自动销毁。
  messageSelfDestructDays: 0,
  momentsVisibility: 'ALL',
  allowStrangerMessages: true,
  showPhone: false,
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
    setLoading(true);
    setError(null);
    try {
      setSettings(await fetchPrivacySettings());
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          t('settingsDetails.privacy.loadFailed'),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function patchSettings(payload: UpdatePrivacySettingsPayload) {
    const previous = currentSettings;
    const next = { ...previous, ...payload };
    setSettings(next);
    setSaving(true);
    setError(null);
    try {
      setSettings(await updatePrivacySettings(payload));
    } catch (requestError) {
      setSettings(previous);
      setError(
        getApiErrorMessage(
          requestError,
          t('settingsDetails.privacy.saveFailed'),
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  const selfDestructOptions = useMemo<PickerOption<SelfDestructDays>[]>(
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

  const addMeCount = [
    currentSettings.addMeByAccount,
    currentSettings.addMeByPhone,
    currentSettings.addMeByQrCode,
    currentSettings.addMeByGroup,
  ].filter(Boolean).length;

  return (
    <>
      <SettingsDetailScreen
        titleKey="settingsDetails.privacy.title"
        sections={[
          {
            rows: [
              {
                id: 'self-destruct',
                labelKey: 'settingsDetails.privacy.selfDestruct',
                valueText: selfDestructLabel(
                  currentSettings.messageSelfDestructDays,
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
                id: 'show-phone',
                labelKey: 'settingsDetails.privacy.showPhone',
                type: 'toggle',
                value: currentSettings.showPhone,
                onValueChange: (value) => void patchSettings({ showPhone: value }),
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
        selectedValue={currentSettings.messageSelfDestructDays}
        onSelect={(value) => void patchSettings({ messageSelfDestructDays: value })}
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
      />
    </>
  );
}

function selfDestructLabel(
  value: SelfDestructDays,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (value === 0) return t('settingsDetails.privacy.selfDestructOff');
  return t('settingsDetails.privacy.days', { count: value });
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
}: {
  visible: boolean;
  settings: PrivacySettings;
  disabled: boolean;
  onClose: () => void;
  onChange: (payload: UpdatePrivacySettingsPayload) => void;
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
      {/*
        byPhone / byQrCode 暂不放出：手机号搜人接口不存在，扫码器
        (resolveMessageScanResult) 也解析不出用户 —— 这两条发现路径在产品里
        还没有，开关拨了不通电，后端也无从 enforce。等功能落地时连同各自入口的
        收口一起放开（账号那条的收口在 UserService.findByExactAccountId）。
        字段本身保留在 PrivacySettings 里，不改服务端契约。
      */}
      <MethodSwitch
        label={t('settingsDetails.privacy.addMe.byGroup')}
        value={settings.addMeByGroup}
        disabled={disabled}
        onValueChange={(value) => onChange({ addMeByGroup: value })}
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
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceBorder, true: colors.blue }}
        thumbColor={colors.white}
      />
    </View>
  );
}
