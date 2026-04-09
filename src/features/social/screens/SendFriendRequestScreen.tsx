import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NavHeader } from '@/components/ui/nav-header';
import { buildSendFriendRequestInitialMessage } from '@/features/social/send-friend-request';
import {
  createFriendRequest,
  fetchFriendTags,
  type FriendTag,
} from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';

const PLACEHOLDER_ROWS = ['备注', '照片备注', '朋友权限'] as const;

const s = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  cardTitle: {
    ...Typography.body,
    fontWeight: '600',
  },
  fieldBlock: {
    gap: Spacing.sm,
  },
  fieldLabel: {
    ...Typography.small,
    fontWeight: '600',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    ...Typography.bodyRegular,
  },
  messageInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  placeholderRow: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  placeholderMeta: {
    flex: 1,
    gap: 4,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tagChip: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  submitButton: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function SendFriendRequestScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const currentUser = useAuthStore((state) => state.user);
  const profileId = typeof params.id === 'string' ? params.id : '';
  const targetName = typeof params.name === 'string' ? params.name : '对方';

  const initialMessage = useMemo(
    () =>
      buildSendFriendRequestInitialMessage({
        nickname: currentUser?.nickname,
        accountId: currentUser?.accountId || '我',
      }),
    [currentUser?.accountId, currentUser?.nickname],
  );
  const [message, setMessage] = useState(initialMessage);
  const [remark, setRemark] = useState('');
  const [tags, setTags] = useState<FriendTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(true);
  const [tagLoadError, setTagLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setIsLoadingTags(true);
    setTagLoadError(null);

    fetchFriendTags()
      .then((nextTags) => {
        if (cancelled) {
          return;
        }

        setTags(nextTags);
        setTagLoadError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setTags([]);
          setTagLoadError('标签加载失败，发送申请时将不会附带标签。');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingTags(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      card: {
        backgroundColor: colors.surface,
      },
      cardTitle: {
        color: colors.text,
      },
      helperText: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      fieldLabel: {
        color: colors.textSecondary,
      },
      input: {
        color: colors.text,
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      placeholderRow: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
        opacity: 0.7,
      },
      placeholderTitle: {
        color: colors.text,
        ...Typography.bodyRegular,
      },
      placeholderHint: {
        color: colors.textSecondary,
        ...Typography.tiny,
      },
      tagChip: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.background,
      },
      tagChipActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primaryLight,
      },
      tagChipText: {
        color: colors.text,
        ...Typography.small,
        fontWeight: '600' as const,
      },
      tagChipTextActive: {
        color: colors.primary,
      },
      submitButton: {
        backgroundColor: colors.primary,
      },
      submitButtonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      submitText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((item) => item !== tagId)
        : [...current, tagId],
    );
  };

  const handleSubmit = async () => {
    if (!profileId || isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      await createFriendRequest({
        targetId: profileId,
        message,
        remark,
        tagIds: selectedTagIds,
      });
      Alert.alert('申请已发送', `已向 ${targetName} 发送好友申请。`, [
        { text: '知道了', onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert(
        '发送失败',
        error instanceof Error ? error.message : '好友申请发送失败，请稍后重试',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="发送好友申请" />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.card, d.card]}>
          <Text style={[s.cardTitle, d.cardTitle]}>{targetName}</Text>
          <Text style={d.helperText}>填写申请信息后发送给对方。</Text>
        </View>

        <View style={[s.card, d.card]}>
          <View style={s.fieldBlock}>
            <Text style={[s.fieldLabel, d.fieldLabel]}>验证消息</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              placeholder="输入验证消息"
              placeholderTextColor={colors.textSecondary}
              style={[s.input, s.messageInput, d.input]}
            />
          </View>

          <View style={s.fieldBlock}>
            <Text style={[s.fieldLabel, d.fieldLabel]}>备注名</Text>
            <TextInput
              value={remark}
              onChangeText={setRemark}
              placeholder="给对方备注一个名字"
              placeholderTextColor={colors.textSecondary}
              style={[s.input, d.input]}
            />
          </View>

          <View style={s.fieldBlock}>
            <Text style={[s.fieldLabel, d.fieldLabel]}>标签</Text>
            {isLoadingTags ? (
              <View style={[s.placeholderRow, d.placeholderRow]}>
                <View style={s.placeholderMeta}>
                  <Text style={d.placeholderTitle}>正在加载标签</Text>
                  <Text style={d.placeholderHint}>稍后可选择要自动应用到好友上的标签</Text>
                </View>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : tags.length > 0 ? (
              <View style={s.tagsWrap}>
                {tags.map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);

                  return (
                    <Pressable
                      key={tag.id}
                      style={[
                        s.tagChip,
                        d.tagChip,
                        selected ? d.tagChipActive : null,
                      ]}
                      onPress={() => toggleTag(tag.id)}
                    >
                      <Text
                        style={[
                          d.tagChipText,
                          selected ? d.tagChipTextActive : null,
                        ]}
                      >
                        {tag.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={[s.placeholderRow, d.placeholderRow]}>
                <View style={s.placeholderMeta}>
                  <Text style={d.placeholderTitle}>暂无标签</Text>
                  <Text style={d.placeholderHint}>
                    {tagLoadError ?? '可稍后在联系人标签中创建'}
                  </Text>
                </View>
                <Ionicons
                  name="pricetag-outline"
                  size={18}
                  color={colors.textSecondary}
                />
              </View>
            )}
          </View>
        </View>

        <View style={[s.card, d.card]}>
          {/* placeholder only rows for Task 4 UI */}
          {PLACEHOLDER_ROWS.map((label) => (
            <Pressable
              key={label}
              disabled
              style={[s.placeholderRow, d.placeholderRow]}
            >
              <View style={s.placeholderMeta}>
                <Text style={d.placeholderTitle}>{label}</Text>
                <Text style={d.placeholderHint}>占位功能，暂未开放</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={[
            s.submitButton,
            d.submitButton,
            !profileId || isSubmitting ? d.submitButtonDisabled : null,
          ]}
          disabled={!profileId || isSubmitting}
          onPress={handleSubmit}
        >
          <Text style={d.submitText}>{isSubmitting ? '发送中...' : '发送'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
