import { useCallback, useMemo, useState } from 'react';
import {
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
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { keyboardDismissOnDragProps } from '@/components/ui/keyboard-dismiss';
import { NavHeader } from '@/components/ui/nav-header';
import { ThemedSwitch } from '@/components/ui/themed-switch';
import { createCircleChatConversation, setGroupChatNotice } from '@/chat-core/api';
import { useChatStore } from '@/chat-core/store';
import { markCircleWrite } from '@/services/api/circles';
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
  broadcastRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg },
  broadcastText: { flex: 1, gap: Spacing.xs },
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
    noticePinned?: string;
  }>();
  const groupID = typeof params.groupID === 'string' ? params.groupID : '';
  // 独立群聊:公告写在会话上,没有圈子 id。
  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const canSave = Boolean(groupID || conversationID);
  const initialNotice = typeof params.notice === 'string' ? params.notice : '';
  const initialPinned = params.noticePinned === 'true';
  const [draft, setDraft] = useState(initialNotice);
  const [pinned, setPinned] = useState(initialPinned);
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
    const nextPinned = Boolean(nextNotice) && pinned;
    if (nextNotice === initialNotice && nextPinned === initialPinned) {
      router.back();
      return;
    }

    setSubmitting(true);
    try {
      const targetID = conversationID || (await createCircleChatConversation(groupID)).id;
      const request = setGroupChatNotice(targetID, nextNotice, nextPinned);
      const result = await (groupID ? markCircleWrite(request) : request);
      const store = useChatStore.getState();
      const cached = store.conversations.find((item) => item.id === targetID);
      if (cached) store.upsertConversation({ ...cached, notice: result.notice, noticePinned: result.noticePinned ?? false });
      router.back();
    } catch (error) {
      reportHandledFailure('chatInfo', 'updateGroupNotice', error);
      Alert.alert(t('chat.groupNotice'), t('common.networkError'));
    } finally {
      setSubmitting(false);
    }
  }, [canSave, conversationID, draft, groupID, initialNotice, initialPinned, pinned, submitting, t]);

  return (
    <KeyboardAvoidingContainer
      style={[s.container, d.container, { paddingTop: insets.top }]}
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
        <View style={[s.broadcastRow, { backgroundColor: colors.surface }]}>
          <View style={s.broadcastText}>
            <Text style={[Typography.bodyRegular, { color: colors.text }]}>{t('chat.noticePinned')}</Text>
            <Text style={[Typography.small, { color: colors.textSecondary }]}>{t('chat.noticePinnedHint')}</Text>
          </View>
          <ThemedSwitch accessibilityRole="switch" accessibilityLabel={t('chat.noticePinned')}
            value={Boolean(draft.trim()) && pinned} onValueChange={setPinned} disabled={submitting || !draft.trim()} />
        </View>
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
    </KeyboardAvoidingContainer>
  );
}
