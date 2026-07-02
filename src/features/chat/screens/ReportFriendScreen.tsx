import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
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
import {
  reportFriend,
  type FriendReportCategory,
} from '@/services/api/friends';
import { reportGroup } from '@/services/api/groups';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';

const CATEGORY_OPTIONS: readonly {
  id: FriendReportCategory;
  labelKey: string;
  descriptionKey: string;
}[] = [
  {
    id: 'harassment',
    labelKey: 'chat.report.categories.harassment.label',
    descriptionKey: 'chat.report.categories.harassment.description',
  },
  {
    id: 'spam',
    labelKey: 'chat.report.categories.spam.label',
    descriptionKey: 'chat.report.categories.spam.description',
  },
  {
    id: 'impersonation',
    labelKey: 'chat.report.categories.impersonation.label',
    descriptionKey: 'chat.report.categories.impersonation.description',
  },
  {
    id: 'fraud',
    labelKey: 'chat.report.categories.fraud.label',
    descriptionKey: 'chat.report.categories.fraud.description',
  },
  {
    id: 'other',
    labelKey: 'chat.report.categories.other.label',
    descriptionKey: 'chat.report.categories.other.description',
  },
];

export default function ReportFriendScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    friendUserId?: string;
    friendName?: string;
    groupID?: string;
    groupName?: string;
    targetType?: 'friend' | 'group';
  }>();
  const targetType = params.targetType === 'group' ? 'group' : 'friend';
  const friendUserId =
    typeof params.friendUserId === 'string' ? params.friendUserId : '';
  const groupID = typeof params.groupID === 'string' ? params.groupID : '';
  const friendName =
    targetType === 'group'
      ? typeof params.groupName === 'string'
        ? params.groupName
        : t('chat.report.fallbackGroup', { defaultValue: '该群聊' })
      : typeof params.friendName === 'string'
        ? params.friendName
        : t('chat.report.fallbackPeer', { defaultValue: '对方' });

  const [category, setCategory] = useState<FriendReportCategory | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Pattern D 第二道：state 在 fast double-tap 下可能晚一帧，用 ref 兜底单飞行。
  const inFlightRef = useRef(false);

  const handleSubmit = useCallback(async () => {
    if (submitting || inFlightRef.current) return;
    if (targetType === 'friend' && !friendUserId) {
      Alert.alert(
        t('chat.report.paramErrorTitle', { defaultValue: '参数错误' }),
        t('chat.report.missingTarget', { defaultValue: '缺少举报对象' }),
      );
      return;
    }
    if (targetType === 'group' && !groupID) {
      Alert.alert(
        t('chat.report.paramErrorTitle', { defaultValue: '参数错误' }),
        t('chat.report.missingTarget', { defaultValue: '缺少举报对象' }),
      );
      return;
    }
    if (!category) {
      Alert.alert(
        t('chat.report.selectCategory', { defaultValue: '请选择举报类别' }),
      );
      return;
    }
    const trimmed = description.trim();
    if (!trimmed) {
      Alert.alert(
        t('chat.report.fillDescription', { defaultValue: '请填写举报说明' }),
      );
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      if (targetType === 'group') {
        await reportGroup(groupID, { category, description: trimmed });
      } else {
        await reportFriend(friendUserId, { category, description: trimmed });
      }
      const successMessage =
        targetType === 'friend'
          ? t('chat.report.successFriend', {
              defaultValue:
                '举报已记录，本次有效举报会影响对方信誉值。',
            })
          : t('chat.report.successGroup', {
              defaultValue: '我们会尽快处理，谢谢你的反馈。',
            });
      Alert.alert(
        t('chat.report.submitted', { defaultValue: '举报已提交' }),
        successMessage,
        [
          {
            text: t('common.ok', { defaultValue: '好的' }),
            onPress: () => router.back(),
          },
        ],
      );
    } catch (error) {
      Alert.alert(
        t('chat.report.submitFailed', { defaultValue: '提交失败' }),
        getApiErrorMessage(
          error,
          t('common.retryLater', { defaultValue: '请稍后重试' }),
        ),
      );
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [category, description, friendUserId, groupID, router, submitting, targetType, t]);

  const submitDisabled =
    submitting || !category || !description.trim();

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
          <Text style={[s.headerTitle, { color: colors.text }]}>
            {t('chat.report.title', { defaultValue: '投诉举报' })}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            s.body,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
        {...keyboardDismissOnDragProps}
        >
          <Text style={[s.target, { color: colors.textSecondary }]}>
            {t('chat.report.targetLabel', { defaultValue: '举报对象：' })}
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {friendName}
            </Text>
          </Text>

          <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>
            {t('chat.report.selectCategoryLabel', {
              defaultValue: '选择举报类别',
            })}
          </Text>
          <View style={[s.categories, { backgroundColor: colors.surface }]}>
            {CATEGORY_OPTIONS.map((opt, idx) => {
              const selected = category === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  style={[
                    s.categoryRow,
                    idx > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.divider,
                    },
                  ]}
                  onPress={() => setCategory(opt.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.categoryLabel, { color: colors.text }]}>
                      {t(opt.labelKey)}
                    </Text>
                    <Text
                      style={[s.categoryDesc, { color: colors.textSecondary }]}
                    >
                      {t(opt.descriptionKey)}
                    </Text>
                  </View>
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={selected ? colors.primary : colors.textSecondary}
                  />
                </Pressable>
              );
            })}
          </View>

          <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>
            {t('chat.report.detailLabel', { defaultValue: '详细说明' })}
          </Text>
          <View style={[s.textareaWrap, { backgroundColor: colors.surface }]}>
            <TextInput
              style={[s.textarea, { color: colors.text }]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('chat.report.detailPlaceholder', {
                defaultValue:
                  '请详细描述发生的事情，便于我们核实处理（最多 500 字）',
              })}
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={500}
            />
            <Text style={[s.counter, { color: colors.textSecondary }]}>
              {description.length} / 500
            </Text>
          </View>
        </ScrollView>

        <View
          style={[
            s.footer,
            { paddingBottom: insets.bottom + Spacing.md, backgroundColor: colors.background },
          ]}
        >
          <Pressable
            style={[
              s.submitBtn,
              {
                backgroundColor: submitDisabled
                  ? colors.surfaceBorder
                  : colors.primary,
              },
            ]}
            onPress={handleSubmit}
            disabled={submitDisabled}
          >
            <Text style={[s.submitText, { color: colors.white }]}>
              {submitting
                ? t('chat.report.submitting', { defaultValue: '提交中...' })
                : t('chat.report.submit', { defaultValue: '提交举报' })}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    height: 48,
  },
  headerTitle: { ...Typography.h3, fontWeight: '700' },
  body: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  target: { ...Typography.bodyRegular },
  sectionLabel: { ...Typography.small, marginTop: Spacing.md },
  categories: {
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  categoryLabel: { ...Typography.body, fontWeight: '600' },
  categoryDesc: { ...Typography.small, marginTop: 2 },
  textareaWrap: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 140,
  },
  textarea: {
    ...Typography.bodyRegular,
    padding: 0,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  counter: {
    ...Typography.tinyRegular,
    textAlign: 'right',
    marginTop: 4,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  submitBtn: {
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { ...Typography.body, fontWeight: '600' },
});
