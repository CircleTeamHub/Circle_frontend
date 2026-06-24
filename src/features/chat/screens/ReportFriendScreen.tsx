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
import {
  reportFriend,
  type FriendReportCategory,
} from '@/services/api/friends';
import { reportGroup } from '@/services/api/groups';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const CATEGORY_OPTIONS: readonly {
  id: FriendReportCategory;
  label: string;
  description: string;
}[] = [
  { id: 'harassment', label: '骚扰', description: '言语攻击、性骚扰、人身威胁' },
  { id: 'spam', label: '垃圾信息', description: '广告、刷屏、诱导引流' },
  { id: 'impersonation', label: '冒充他人', description: '盗用身份、虚假身份' },
  { id: 'fraud', label: '欺诈', description: '诈骗、虚假交易、链接钓鱼' },
  { id: 'other', label: '其他', description: '违反平台规则的其他行为' },
];

export default function ReportFriendScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
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
        : '该群聊'
      : typeof params.friendName === 'string'
        ? params.friendName
        : '对方';

  const [category, setCategory] = useState<FriendReportCategory | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Pattern D 第二道：state 在 fast double-tap 下可能晚一帧，用 ref 兜底单飞行。
  const inFlightRef = useRef(false);

  const handleSubmit = useCallback(async () => {
    if (submitting || inFlightRef.current) return;
    if (targetType === 'friend' && !friendUserId) {
      Alert.alert('参数错误', '缺少举报对象');
      return;
    }
    if (targetType === 'group' && !groupID) {
      Alert.alert('参数错误', '缺少举报对象');
      return;
    }
    if (!category) {
      Alert.alert('请选择举报类别');
      return;
    }
    const trimmed = description.trim();
    if (!trimmed) {
      Alert.alert('请填写举报说明');
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
      Alert.alert('举报已提交', '我们会尽快处理，谢谢你的反馈。', [
        { text: '好的', onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert('提交失败', getApiErrorMessage(error, '请稍后重试'));
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, [category, description, friendUserId, groupID, router, submitting, targetType]);

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
          <Text style={[s.headerTitle, { color: colors.text }]}>投诉举报</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            s.body,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[s.target, { color: colors.textSecondary }]}>
            举报对象：
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {friendName}
            </Text>
          </Text>

          <Text style={[s.sectionLabel, { color: colors.textSecondary }]}>
            选择举报类别
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
                      {opt.label}
                    </Text>
                    <Text
                      style={[s.categoryDesc, { color: colors.textSecondary }]}
                    >
                      {opt.description}
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
            详细说明
          </Text>
          <View style={[s.textareaWrap, { backgroundColor: colors.surface }]}>
            <TextInput
              style={[s.textarea, { color: colors.text }]}
              value={description}
              onChangeText={setDescription}
              placeholder="请详细描述发生的事情，便于我们核实处理（最多 500 字）"
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
              {submitting ? '提交中...' : '提交举报'}
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
