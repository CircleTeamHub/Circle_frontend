import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/avatar';
import { useTransferComposerStore } from '@/features/chat/store/use-transfer-composer-store';
import { fromImUserId } from '@/im/client';
import { fetchWallet, sendCoinGift } from '@/services/api/coin';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

export default function TransferComposerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    recipientId?: string;
    recipientName?: string;
    recipientAvatar?: string;
  }>();
  const recipientId =
    typeof params.recipientId === 'string' ? params.recipientId : '';
  const recipientName =
    typeof params.recipientName === 'string' ? params.recipientName : '对方';
  const recipientAvatar =
    typeof params.recipientAvatar === 'string'
      ? params.recipientAvatar
      : undefined;

  const setPending = useTransferComposerStore((s) => s.setPending);

  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchWallet()
      .then((wallet) => {
        if (!cancelled) setBalance(wallet.balance);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingBalance(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    const value = Number(amount.trim());
    if (!Number.isInteger(value) || value <= 0) {
      Alert.alert('请输入正整数积分');
      return;
    }
    if (balance != null && value > balance) {
      Alert.alert('余额不足', `当前积分余额：${balance}`);
      return;
    }

    setSubmitting(true);
    try {
      await sendCoinGift({
        // 后端期望业务侧 UUID（带连字符）；如果 sourceID 是从消息列表来的 IM 形式，
        // 这里还原。已经是 UUID 的字符串会原样透传。
        recipientId: fromImUserId(recipientId),
        amount: value,
        message: message.trim() || undefined,
      });
      // 转账成功后通过 store 通知 ChatDetailScreen 在重新拿到焦点时
      // 发出对应 IM 卡片消息（不在这里发，避免 IM 失败但积分已扣）
      setPending({
        amount: value,
        message: message.trim() || null,
      });
      router.back();
    } catch (error) {
      Alert.alert('转账失败', getApiErrorMessage(error, '请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  }, [amount, balance, message, recipientId, router, setPending, submitting]);

  const value = Number(amount.trim());
  const submitDisabled =
    submitting ||
    !Number.isInteger(value) ||
    value <= 0 ||
    (balance != null && value > balance);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={[
          s.container,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <View style={s.header}>
          <Pressable hitSlop={8} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[s.headerTitle, { color: colors.text }]}>积分转账</Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={[s.recipient, { backgroundColor: colors.surface }]}>
          <Avatar
            size={48}
            shape="square"
            name={recipientName}
            uri={recipientAvatar}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.recipientLabel, { color: colors.textSecondary }]}>
              转给
            </Text>
            <Text
              style={[s.recipientName, { color: colors.text }]}
              numberOfLines={1}
            >
              {recipientName}
            </Text>
          </View>
        </View>

        <View style={s.amountSection}>
          <Text style={[s.amountLabel, { color: colors.textSecondary }]}>
            转账积分
          </Text>
          <View style={s.amountRow}>
            <TextInput
              style={[s.amountInput, { color: colors.text }]}
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              maxLength={8}
            />
            <Text style={[s.amountUnit, { color: colors.text }]}>积分</Text>
          </View>
          {loadingBalance ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : (
            <Text style={[s.balanceText, { color: colors.textSecondary }]}>
              当前余额：{balance ?? '-'} 积分
            </Text>
          )}
        </View>

        <View style={[s.messageField, { backgroundColor: colors.surface }]}>
          <TextInput
            style={[s.messageInput, { color: colors.text }]}
            value={message}
            onChangeText={setMessage}
            placeholder="留言（可选，最多 100 字）"
            placeholderTextColor={colors.textSecondary}
            maxLength={100}
            multiline
          />
        </View>

        <View style={{ flex: 1 }} />

        <Pressable
          style={[
            s.submitBtn,
            {
              backgroundColor: submitDisabled
                ? colors.surfaceBorder
                : colors.primary,
              marginBottom: insets.bottom + Spacing.md,
            },
          ]}
          onPress={handleSubmit}
          disabled={submitDisabled}
        >
          <Text style={[s.submitText, { color: colors.white }]}>
            {submitting ? '转账中...' : '确认转账'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
  },
  headerTitle: { ...Typography.h3, fontWeight: '700' },
  recipient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginTop: Spacing.md,
  },
  recipientLabel: { ...Typography.small },
  recipientName: { ...Typography.h3, fontWeight: '700' },
  amountSection: { marginTop: Spacing.xl, gap: Spacing.sm },
  amountLabel: { ...Typography.small },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
  },
  amountInput: {
    flex: 1,
    fontSize: 36,
    fontWeight: '700',
    paddingVertical: 6,
    minHeight: 50,
  },
  amountUnit: { ...Typography.body, fontWeight: '600' },
  balanceText: { ...Typography.small, marginTop: Spacing.xs },
  messageField: {
    marginTop: Spacing.lg,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 64,
  },
  messageInput: {
    ...Typography.bodyRegular,
    padding: 0,
    minHeight: 48,
    textAlignVertical: 'top',
  },
  submitBtn: {
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { ...Typography.body, fontWeight: '600' },
});
