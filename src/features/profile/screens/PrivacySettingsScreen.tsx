import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ThemedSwitch } from '@/components/ui/themed-switch';
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
import { useChatStore } from '@/chat-core/store';
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
        .setViewerSelfDestructDays(loaded.messageSelfDestructDays);
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
        .setViewerSelfDestructDays(updated.messageSelfDestructDays);
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

  // 只算界面上真的有开关的那几项。byPhone / byQrCode 的开关已撤下（对应功能
  // 不存在，见下方 sheet 里的说明），但字段仍会随服务端返回，且 addMeByQrCode
  // 默认为 true —— 算进来的话摘要会显示「已开启 3 项」，点开却只有两个开关，
  // 多出来的那一项用户既看不到也改不了。放开关时把对应项加回这里。
  const addMeCount = [
    currentSettings.addMeByAccount,
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
      <ThemedSwitch
        tint={colors.blue}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
      />
    </View>
  );
}
