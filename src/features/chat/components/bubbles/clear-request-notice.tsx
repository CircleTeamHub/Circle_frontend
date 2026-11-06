import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { respondChatHistoryClear } from '@/chat-core/api';
import { reportHandledFailure } from '@/observability/report-failure';
import { ApiError } from '@/services/api/client';
import { getApiErrorMessage } from '@/services/api/errors';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { SystemNoticePill } from './system-notice-pill';

interface ClearRequestNoticeProps {
  text: string;
  requestId: string;
  /** 对方发来、还没答复过的才给按钮。 */
  actionable: boolean;
}

const s = StyleSheet.create({
  actions: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md, marginTop: -Spacing.xs, marginBottom: Spacing.sm },
  button: { minWidth: 96, height: 36, paddingHorizontal: Spacing.md, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...Typography.small, fontWeight: '600' },
});

/** 私聊里的「对方申请双向清空」提示:下面两个按钮,同意后服务端清掉我这边的记录。 */
export function ClearRequestNotice({ text, requestId, actionable }: ClearRequestNoticeProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  const respond = async (accept: boolean) => {
    if (state !== 'idle') return;
    setState('busy');
    try {
      await respondChatHistoryClear(requestId, accept);
      setState('done');
    } catch (error) {
      // 另一台设备先答复过:按已处理收起按钮,不当成失败。
      if (error instanceof ApiError && error.status === 409) {
        setState('done');
        return;
      }
      reportHandledFailure('chatDetail', 'respondClearRequest', error);
      setState('idle');
      Alert.alert(
        t('chat.clearRequest.failed', { defaultValue: '操作失败' }),
        getApiErrorMessage(error, t('common.retryLater', { defaultValue: '请稍后重试' })),
      );
    }
  };

  return (
    <View>
      <SystemNoticePill text={text} />
      {actionable && state !== 'done' ? (
        <View style={s.actions}>
          <Pressable
            style={[s.button, { backgroundColor: colors.surface }]}
            onPress={() => void respond(false)}
            disabled={state === 'busy'}
            accessibilityRole="button"
          >
            <Text style={[s.buttonText, { color: colors.text }]}>
              {t('chat.clearRequest.decline', { defaultValue: '拒绝' })}
            </Text>
          </Pressable>
          <Pressable
            style={[s.button, { backgroundColor: colors.error }]}
            onPress={() => void respond(true)}
            disabled={state === 'busy'}
            accessibilityRole="button"
          >
            {state === 'busy' ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[s.buttonText, { color: colors.white }]}>
                {t('chat.clearRequest.accept', { defaultValue: '确定授权' })}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
