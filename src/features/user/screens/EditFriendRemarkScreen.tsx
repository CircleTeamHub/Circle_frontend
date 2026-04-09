import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import {
  fetchFriendSettings,
  setFriendRemark,
} from '@/services/api/friends';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  fieldLabel: {
    ...Typography.small,
    fontWeight: '600',
  },
  helper: {
    ...Typography.small,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.bodyRegular,
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: 56,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  button: {
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function EditFriendRemarkScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const profileId = typeof params.id === 'string' ? params.id : '';
  const targetName = typeof params.name === 'string' ? params.name : '好友';

  const [value, setValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!profileId) {
      setError('好友不存在');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetchFriendSettings(profileId)
      .then((settings) => {
        if (cancelled) {
          return;
        }

        setValue(settings.remark ?? '');
        setError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setError('备注加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      card: {
        backgroundColor: colors.surface,
      },
      fieldLabel: {
        color: colors.textSecondary,
      },
      helper: {
        color: colors.textSecondary,
      },
      input: {
        color: colors.text,
        backgroundColor: colors.background,
        borderColor: colors.surfaceBorder,
      },
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      button: {
        backgroundColor: colors.primary,
      },
      buttonDisabled: {
        backgroundColor: colors.surfaceBorder,
      },
      buttonText: {
        color: colors.white,
        ...Typography.body,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const handleSave = async () => {
    if (!profileId || isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      await setFriendRemark(profileId, value);
      router.back();
    } catch (nextError) {
      Alert.alert(
        '保存失败',
        nextError instanceof Error ? nextError.message : '备注保存失败，请稍后重试',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const stateBlock = isLoading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>正在加载备注...</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
    </View>
  ) : (
    <View style={[s.card, d.card]}>
      <Text style={[s.fieldLabel, d.fieldLabel]}>给 {targetName} 的备注</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        maxLength={50}
        placeholder="输入备注名"
        placeholderTextColor={colors.textSecondary}
        style={[s.input, d.input]}
      />
      <Text style={[s.helper, d.helper]}>
        备注会显示在联系人列表和好友详情页，可留空清除。
      </Text>
    </View>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title="设置备注" />
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {stateBlock}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={[
            s.button,
            d.button,
            isLoading || Boolean(error) || isSaving ? d.buttonDisabled : null,
          ]}
          disabled={isLoading || Boolean(error) || isSaving}
          onPress={handleSave}
        >
          <Text style={d.buttonText}>{isSaving ? '保存中...' : '保存'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
