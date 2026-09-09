import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { NavHeader } from '@/components/ui/nav-header';
import { setGroupChatNotice } from '@/chat-core/api';
import { useChatStore } from '@/chat-core/store';
import { updateCircle } from '@/services/api/circles';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  input: {
    minHeight: 180,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function EditGroupNoticeScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    groupID?: string;
    conversationID?: string;
    groupTitle?: string;
    notice?: string;
  }>();
  const groupID = typeof params.groupID === 'string' ? params.groupID : '';
  // 独立群聊:公告写在会话上,没有圈子 id。
  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const canSave = Boolean(groupID || conversationID);
  const initialNotice = typeof params.notice === 'string' ? params.notice : '';
  const [draft, setDraft] = useState(initialNotice);
  const [submitting, setSubmitting] = useState(false);

  const d = useMemo(
    () => ({
      container: {
        backgroundColor: colors.background,
      },
      input: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
        color: colors.text,
        ...Typography.bodyRegular,
      },
      saveButton: {
        backgroundColor: submitting ? colors.surfaceBorder : colors.primary,
      },
      saveText: {
        color: colors.white,
        ...Typography.body,
      },
    }),
    [colors, submitting],
  );

  const handleSave = useCallback(async () => {
    if (!canSave || submitting) {
      return;
    }

    const nextNotice = draft.trim();
    if (nextNotice === initialNotice) {
      router.back();
      return;
    }

    setSubmitting(true);
    try {
      if (groupID) {
        // 自研栈下「群=圈子」:群公告即圈子简介,读写统一走 circle.description。
        await updateCircle(groupID, { description: nextNotice });
      } else {
        const result = await setGroupChatNotice(conversationID, nextNotice);
        // 群信息页从会话 dto 读公告:回写本机缓存,退回去立刻看到新公告。
        const store = useChatStore.getState();
        const cached = store.conversations.find((item) => item.id === conversationID);
        if (cached) store.upsertConversation({ ...cached, notice: result.notice });
      }
      router.back();
    } catch (error) {
      reportHandledFailure('chatInfo', 'updateGroupNotice', error);
      Alert.alert(t('chat.groupNotice'), t('common.networkError'));
    } finally {
      setSubmitting(false);
    }
  }, [canSave, conversationID, draft, groupID, initialNotice, submitting, t]);

  return (
    <KeyboardAvoidingView
      style={[s.container, d.container, { paddingTop: insets.top }]}
      behavior="padding"
    >
      <NavHeader title={t('chat.groupNotice')} />
      <ScrollView
        contentContainerStyle={s.body}
        showsVerticalScrollIndicator={false}
        {...keyboardDismissOnDragProps}
      >
        <TextInput
          style={[s.input, d.input]}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chat.noGroupNotice')}
          placeholderTextColor={colors.textSecondary}
          multiline
          autoFocus
          editable={!submitting}
        />
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <Pressable
          style={[s.saveButton, d.saveButton]}
          onPress={handleSave}
          disabled={submitting || !canSave}
        >
          <Text style={d.saveText}>{t('common.save')}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
