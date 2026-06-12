import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/avatar';
import { BottomSheetModal } from '@/components/ui/bottom-sheet-modal';
import { Divider } from '@/components/ui/divider';
import { useAuth } from '@/hooks/use-auth';
import { useAccountSwitcherStore } from '@/stores/accountSwitcherStore';
import { useAuthStore } from '@/stores/authStore';
import {
  useKnownAccountsStore,
  type KnownAccount,
} from '@/stores/knownAccountsStore';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  title: { ...Typography.h3 },
  closeBtn: { padding: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 64,
  },
  textBlock: { flex: 1, gap: 2 },
  nickname: { ...Typography.body, fontWeight: '600' },
  accountId: { ...Typography.caption },
  empty: {
    ...Typography.caption,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 56,
  },
  addIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { ...Typography.body, fontWeight: '600' },
});

interface AccountRowProps {
  account: KnownAccount;
  isCurrent: boolean;
  disabled: boolean;
  onPress: () => void;
}

function AccountRow({ account, isCurrent, disabled, onPress }: AccountRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Pressable
      style={s.row}
      onPress={isCurrent || disabled ? undefined : onPress}
      disabled={isCurrent || disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: isCurrent, disabled }}
    >
      <Avatar
        size={44}
        uri={account.user.avatarUrl ?? undefined}
        name={account.user.nickname}
      />
      <View style={s.textBlock}>
        <Text style={[s.nickname, { color: colors.text }]} numberOfLines={1}>
          {account.user.nickname}
        </Text>
        <Text style={[s.accountId, { color: colors.textSecondary }]} numberOfLines={1}>
          {account.user.accountId}
        </Text>
      </View>
      {isCurrent ? (
        <Text style={[s.accountId, { color: colors.primary }]}>
          {t('accountSwitcher.current')}
        </Text>
      ) : (
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      )}
    </Pressable>
  );
}

export function AccountSwitcherSheet() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { switchToAccount, submitting } = useAuth();

  const isOpen = useAccountSwitcherStore((state) => state.isOpen);
  const close = useAccountSwitcherStore((state) => state.close);
  const accounts = useKnownAccountsStore((state) => state.accounts);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  const d = useMemo(
    () => ({
      backdrop: { backgroundColor: colors.overlay },
      sheet: { backgroundColor: colors.surface },
      handle: { backgroundColor: colors.surfaceBorder },
      addIcon: { backgroundColor: colors.primaryLight },
    }),
    [colors],
  );

  function handleAddAccount() {
    close();
    router.push('/(auth)/login');
  }

  return (
    <BottomSheetModal
      visible={isOpen}
      onClose={close}
      closeOnBackdropPress={!submitting}
      backdropStyle={d.backdrop}
      sheetStyle={[s.sheet, d.sheet, { paddingBottom: insets.bottom || Spacing.lg }]}
    >
      <View style={[s.handle, d.handle]} />
      <View style={s.header}>
        <Text style={[s.title, { color: colors.text }]}>
          {t('accountSwitcher.title')}
        </Text>
        <Pressable
          style={s.closeBtn}
          onPress={close}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: 380 }}
      >
        {accounts.length === 0 ? (
          <Text style={[s.empty, { color: colors.textSecondary }]}>
            {t('accountSwitcher.empty')}
          </Text>
        ) : (
          accounts.map((account) => (
            <AccountRow
              key={account.user.id}
              account={account}
              isCurrent={account.user.id === currentUserId}
              disabled={submitting}
              onPress={() => void switchToAccount(account)}
            />
          ))
        )}

        <Divider />

        <Pressable
          style={s.addRow}
          onPress={handleAddAccount}
          disabled={submitting}
          accessibilityRole="button"
        >
          <View style={[s.addIcon, d.addIcon]}>
            {submitting ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="add" size={24} color={colors.primary} />
            )}
          </View>
          <Text style={[s.addLabel, { color: colors.primary }]}>
            {t('accountSwitcher.addAccount')}
          </Text>
        </Pressable>
      </ScrollView>
    </BottomSheetModal>
  );
}
