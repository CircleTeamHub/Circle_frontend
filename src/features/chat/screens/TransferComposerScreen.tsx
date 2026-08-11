import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import {
  resolveTransferIdempotency,
  type TransferIdempotency,
} from '@/features/chat/utils/transfer-idempotency';
import { normalizeUserIdAlias } from '@/utils/user-id-alias';
import { fetchWallet, sendCoinGift } from '@/services/api/coin';
import {
  getCreditPolicyMessage,
  getLocalLowCreditDecision,
} from '@/services/api/credit-policy';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

export default function TransferComposerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    recipientId?: string;
    recipientName?: string;
    recipientAvatar?: string;
  }>();
  const recipientId =
    typeof params.recipientId === 'string' ? params.recipientId : '';
  const recipientName =
    typeof params.recipientName === 'string'
      ? params.recipientName
      : t('chat.transfer.fallbackRecipient', { defaultValue: '对方' });
  const recipientAvatar =
    typeof params.recipientAvatar === 'string'
      ? params.recipientAvatar
      : undefined;


  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [balanceError, setBalanceError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Pattern D 第二道：state 在 fast double-tap 下可能晚一帧，用 ref 在 handler 入口兜底。
  const inFlightRef = useRef(false);
  const idempotencyRef = useRef<TransferIdempotency | null>(null);

  // 余额加载逻辑抽出函数 —— 失败后用户能从 UI 重试，不必退出页面重进。
  const loadBalance = useCallback(() => {
    let cancelled = false;
    setLoadingBalance(true);
    setBalanceError(false);
    fetchWallet()
      .then((wallet) => {
        if (!cancelled) {
          setBalance(wallet.balance);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBalance(null);
          setBalanceError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBalance(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return loadBalance();
  }, [loadBalance]);

  const handleSubmit = useCallback(async () => {
    if (submitting || inFlightRef.current) return;
    const value = Number(amount.trim());
    if (!Number.isInteger(value) || value <= 0) {
      Alert.alert(t('chat.transfer.invalidAmount', { defaultValue: '请输入正整数积分' }));
      return;
    }
    // 余额还在加载或加载失败时不允许提交：之前 balance===null 走 fall-through
    // 把客户端检查直接跳过，用户可以发起 > 实际余额的转账，全靠服务端拒回兜底。
    if (balance == null) {
      Alert.alert(
        t('chat.transfer.balanceNotReadyTitle', { defaultValue: '余额未就绪' }),
        t('chat.transfer.balanceNotReadyMsg', {
          defaultValue: '请等待余额加载完成后再试',
        }),
      );
      return;
    }
    if (value > balance) {
      Alert.alert(
        t('chat.transfer.insufficientTitle', { defaultValue: '余额不足' }),
        t('chat.transfer.currentBalanceMsg', {
          defaultValue: '当前积分余额：{{balance}}',
          balance,
        }),
      );
      return;
    }

    // 信用分门禁必须拦在扣款之前 —— 这是转账链路上端侧唯一的一道闸。
    // 扣款之后已经没有可拦的东西了:钱在服务端划走,卡片也由服务端签发,
    // 客户端从头到尾碰不到 chat-core 的发送路径(那里的门禁看不见转账)。
    const creditDenied = getLocalLowCreditDecision();
    if (creditDenied) {
      Alert.alert(
        t('chat.transfer.failedTitle', { defaultValue: '转账失败' }),
        getCreditPolicyMessage(creditDenied),
      );
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const normalizedRecipientId = normalizeUserIdAlias(recipientId);
      const normalizedMessage = message.trim() || null;
      const idempotency = resolveTransferIdempotency(idempotencyRef.current, {
        recipientId: normalizedRecipientId,
        amount: value,
        message: normalizedMessage,
      });
      idempotencyRef.current = idempotency;
      await sendCoinGift(
        {
          // 后端期望业务侧 UUID（带连字符）；如果 sourceID 是从消息列表来的 IM 形式，
          // 这里还原。已经是 UUID 的字符串会原样透传。
          recipientId: normalizedRecipientId,
          amount: value,
          message: normalizedMessage || undefined,
        },
        { idempotencyKey: idempotency.key },
      );
      // 卡片不用这边发:transfer-card 断言的是「钱已经划走」这个服务端事实,
      // 由后端在结算提交后就地签发,经 chat:msg 广播回来。以前是转账成功后把
      // payload 挂到 store、让 ChatDetailScreen 重新聚焦时补发一条 —— 而那条
      // 发送被服务端 100% 拒收(transfer-card 是服务端专属类型)。
      idempotencyRef.current = null;
      router.back();
    } catch (error) {
      Alert.alert(
        t('chat.transfer.failedTitle', { defaultValue: '转账失败' }),
        getApiErrorMessage(
          error,
          t('common.retryLater', { defaultValue: '请稍后重试' }),
        ),
      );
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [amount, balance, message, recipientId, router, submitting, t]);

  const value = Number(amount.trim());
  const submitDisabled =
    submitting ||
    !Number.isInteger(value) ||
    value <= 0 ||
    balance == null ||
    value > balance;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={[s.scroll, { backgroundColor: colors.background }]}
        contentContainerStyle={[s.container, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <View style={s.header}>
          <Pressable hitSlop={8} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[s.headerTitle, { color: colors.text }]}>
            {t('chat.transfer.title', { defaultValue: '积分转账' })}
          </Text>
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
              {t('chat.transfer.to', { defaultValue: '转给' })}
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
            {t('chat.transfer.amountLabel', { defaultValue: '转账积分' })}
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
            <Text style={[s.amountUnit, { color: colors.text }]}>
              {t('common.coin', { defaultValue: '积分' })}
            </Text>
          </View>
          {loadingBalance ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : balanceError ? (
            <View style={s.balanceErrorRow}>
              <Text style={[s.balanceText, { color: colors.error }]}>
                {t('chat.transfer.balanceLoadFailed', {
                  defaultValue: '余额加载失败',
                })}
              </Text>
              <Pressable
                hitSlop={6}
                onPress={loadBalance}
                style={[s.balanceRetry, { borderColor: colors.primary }]}
              >
                <Text
                  style={[Typography.small, { color: colors.primary, fontWeight: '600' }]}
                >
                  {t('common.retry', { defaultValue: '重试' })}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[s.balanceText, { color: colors.textSecondary }]}>
              {t('chat.transfer.currentBalancePrefix', { defaultValue: '当前余额：' })}
              {balance ?? '-'} {t('common.coin', { defaultValue: '积分' })}
            </Text>
          )}
        </View>

        <View style={[s.messageField, { backgroundColor: colors.surface }]}>
          <TextInput
            style={[s.messageInput, { color: colors.text }]}
            value={message}
            onChangeText={setMessage}
            placeholder={t('chat.transfer.messagePlaceholder', {
              defaultValue: '留言（可选，最多 100 字）',
            })}
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
            {submitting
              ? t('chat.transfer.submitting', { defaultValue: '转账中...' })
              : t('chat.transfer.submit', { defaultValue: '确认转账' })}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  container: { flexGrow: 1, paddingHorizontal: Spacing.lg },
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
  balanceErrorRow: {
    marginTop: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  balanceRetry: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
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
