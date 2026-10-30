import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AssistantAvatar } from '@/features/assistant/components/AssistantAvatar';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import {
  createAssistantSubscription,
  fetchAssistantBootstrap,
} from '@/services/api/assistant';
import type {
  AssistantBootstrapResponse,
  AssistantCircleContext,
} from '@/features/assistant/types';
import { useChatStore } from '@/chat-core/store';
import { getApiErrorMessage } from '@/services/api/errors';
import { useTheme, Radius, Spacing, Typography } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';
import { useDiscoverStore } from '@/features/discover/store/use-discover-store';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import type { Circle } from '@/types';

type WizardStep = 'circle' | 'keywords' | 'note-status';
type ChatEntry = {
  id: number;
  role: 'assistant' | 'user';
  text: string;
};

function circleContext(circle: Circle): AssistantCircleContext {
  return { id: circle.id, name: circle.name, cities: circle.cities };
}

function splitKeywords(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function circleScopeText(
  circle: AssistantCircleContext,
  allCitiesLabel: string,
): string {
  return circle.cities.length > 0 ? circle.cities.join('、') : allCitiesLabel;
}

export default function AssistantChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const contextCircleId = useDiscoverStore((state) => state.selectedCircleId);
  const joinedCircles = useCirclesStore((state) => state.joinedCircles);
  const createdCircles = useCirclesStore((state) => state.createdCircles);
  const fetchMyCircles = useCirclesStore((state) => state.fetchMyCircles);
  const [bootstrap, setBootstrap] = useState<AssistantBootstrapResponse | null>(
    null,
  );
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>('circle');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const entryIdRef = useRef(0);

  const circles = useMemo(() => {
    const byId = new Map<string, Circle>();
    for (const circle of joinedCircles) byId.set(circle.id, circle);
    for (const circle of createdCircles) byId.set(circle.id, circle);
    return [...byId.values()];
  }, [createdCircles, joinedCircles]);

  const availableCircles = useMemo(() => {
    const byId = new Map(circles.map((circle) => [circle.id, circle]));
    const context = bootstrap?.contextCircle;
    if (context && !byId.has(context.id)) {
      byId.set(context.id, {
        id: context.id,
        name: context.name,
        cities: context.cities,
      } as Circle);
    }
    return [...byId.values()];
  }, [bootstrap?.contextCircle, circles]);

  const selectedCircle = useMemo<AssistantCircleContext | null>(() => {
    if (!selectedCircleId) return null;
    if (bootstrap?.contextCircle?.id === selectedCircleId) {
      return bootstrap.contextCircle;
    }
    const cached = availableCircles.find((circle) => circle.id === selectedCircleId);
    return cached ? circleContext(cached) : null;
  }, [availableCircles, bootstrap?.contextCircle, selectedCircleId]);

  const appendEntry = useCallback((role: ChatEntry['role'], text: string) => {
    entryIdRef.current += 1;
    setEntries((current) => [
      ...current,
      { id: entryIdRef.current, role, text },
    ]);
  }, []);

  const navigateToChat = useCallback(
    (data: AssistantBootstrapResponse) => {
      useChatStore
        .getState()
        .mergeConversationSnapshot(data.conversation);
      router.replace({
        pathname: '/(tabs)/messages/chat-detail',
        params: {
          conversationID: data.conversation.id,
          sourceID: data.conversation.id,
          title: data.assistant.displayName,
          conversationType: 'private',
          conversationKind: 'support',
          assistantKey: data.assistant.key,
        },
      });
    },
    [router],
  );

  const startWizard = useCallback(
    (data: AssistantBootstrapResponse) => {
      entryIdRef.current = 0;
      setSelectedCircleId(null);
      setKeywords([]);
      setKeywordDraft('');
      setStep('circle');
      const contextText = data.contextCircle
        ? t('assistant.askCircleWithContext', {
            defaultValue:
              '你现在正在浏览「{{circle}}」。要关注这个圈子吗？也可以选择其他圈子。',
            circle: data.contextCircle.name,
          })
        : t('assistant.askCircle', {
            defaultValue: '你想关注哪个圈子的信息？',
          });
      setEntries([
        {
          id: 1,
          role: 'assistant',
          text: t('assistant.intro', {
            defaultValue:
              '你好，我是风信助手。我可以根据你关注的圈子和关键词提醒城市信息，也可以提醒你关注的笔记被下架。',
          }),
        },
        { id: 2, role: 'assistant', text: contextText },
      ]);
      entryIdRef.current = 2;
      if (!data.contextCircle) void fetchMyCircles();
    },
    [fetchMyCircles, t],
  );

  const openAssistant = useCallback(async () => {
    setError(null);
    try {
      const next = await fetchAssistantBootstrap(contextCircleId);
      setBootstrap(next);
      if (!next.capabilities.infoSubscriptions) {
        navigateToChat(next);
        return;
      }
      const activeSubscription = next.subscriptions.some(
        (subscription) =>
          subscription.enabled &&
          subscription.sourceTypes.includes('PLAZA_POST') &&
          (!contextCircleId || subscription.circleId === contextCircleId),
      );
      if (activeSubscription) {
        navigateToChat(next);
        return;
      }
      startWizard(next);
    } catch (cause) {
      reportHandledFailure('assistant', 'bootstrap', cause);
      setError(getApiErrorMessage(cause, t('common.networkError')));
    }
  }, [contextCircleId, navigateToChat, startWizard, t]);

  useEffect(() => {
    void openAssistant();
  }, [openAssistant]);

  const handleCircleSelect = useCallback(
    (circleId: string) => {
      const circle = availableCircles.find((item) => item.id === circleId);
      if (!circle) return;
      const context = circleContext(circle);
      setSelectedCircleId(circleId);
      appendEntry(
        'user',
        t('assistant.selectedCircle', {
          defaultValue: '我想关注「{{circle}}」。',
          circle: context.name,
        }),
      );
      appendEntry(
        'assistant',
        t('assistant.askKeywords', {
          defaultValue:
            '好的。你想关注哪些关键词？可以输入多个，用逗号分隔；也可以选择关注这个圈子的全部信息。',
        }),
      );
      setStep('keywords');
    },
    [appendEntry, availableCircles, t],
  );

  const addKeyword = useCallback(() => {
    const next = splitKeywords(keywordDraft);
    if (next.length === 0) return;
    setKeywords((current) => [...new Set([...current, ...next])].slice(0, 20));
    setKeywordDraft('');
  }, [keywordDraft]);

  const continueToNoteStatus = useCallback(
    (unrestricted: boolean) => {
      const nextDraftKeywords = unrestricted ? [] : splitKeywords(keywordDraft);
      const nextKeywords = unrestricted
        ? []
        : [...new Set([...keywords, ...nextDraftKeywords])].slice(0, 20);
      const useAllKeywords = unrestricted || nextKeywords.length === 0;
      setKeywords(nextKeywords);
      setKeywordDraft('');
      appendEntry(
        'user',
        useAllKeywords
          ? t('assistant.allKeywords', { defaultValue: '关注这个圈子的全部信息。' })
          : t('assistant.selectedKeywords', {
              defaultValue: '我关注：{{keywords}}。',
              keywords: nextKeywords.join('、'),
            }),
      );
      appendEntry(
        'assistant',
        t('assistant.askNoteStatus', {
          defaultValue: '最后一个问题：要不要提醒你关注的笔记被作者下架或删除？',
        }),
      );
      setStep('note-status');
    },
    [appendEntry, keywordDraft, keywords, t],
  );

  const handleNoteStatusChoice = useCallback(
    async (enabled: boolean) => {
      if (!selectedCircleId || !bootstrap || submitting) return;
      setSubmitting(true);
      setError(null);
      appendEntry(
        'user',
        enabled
          ? t('assistant.noteStatusYes', { defaultValue: '需要，提醒我。' })
          : t('assistant.noteStatusNo', { defaultValue: '暂时不用。' }),
      );
      try {
        await createAssistantSubscription({
          circleId: selectedCircleId,
          keywords,
          noteStatusAlerts: enabled,
        });
        navigateToChat(bootstrap);
      } catch (cause) {
        reportHandledFailure('assistant', 'createSubscription', cause);
        const message = getApiErrorMessage(cause, t('common.networkError'));
        setError(message);
        appendEntry('assistant', message);
      } finally {
        setSubmitting(false);
      }
    },
    [appendEntry, bootstrap, keywords, navigateToChat, selectedCircleId, submitting, t],
  );

  if (error && !bootstrap) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <AssistantAvatar size={76} />
        <Text selectable style={[styles.error, { color: colors.textSecondary }]}>
          {error}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void openAssistant()}
          style={[styles.retry, { borderColor: colors.primary }]}
        >
          <Text style={[styles.retryText, { color: colors.primary }]}>
            {t('common.retry', { defaultValue: '重试' })}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!bootstrap) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <AssistantAvatar size={76} />
        <ActivityIndicator color={colors.primary} style={styles.loader} />
        <Text style={[styles.loading, { color: colors.textSecondary }]}>
          {t('common.loading', { defaultValue: '加载中…' })}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingContainer
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.chatContainer,
          {
            paddingTop: insets.top + Spacing.md,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.assistantHeader}>
          <AssistantAvatar size={48} />
          <View style={styles.headerCopy}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {t('assistant.name', { defaultValue: '风信助手' })}
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              {t('assistant.subtitle', { defaultValue: '提醒助手' })}
            </Text>
          </View>
        </View>

        <View style={styles.messages}>
          {entries.map((entry) => (
            <View
              key={entry.id}
              style={[
                styles.bubble,
                entry.role === 'user' ? styles.userBubble : styles.assistantBubble,
                {
                  alignSelf: entry.role === 'user' ? 'flex-end' : 'flex-start',
                  backgroundColor:
                    entry.role === 'user' ? colors.primary : colors.surface,
                },
              ]}
            >
              <Text
                selectable
                style={{
                  color: entry.role === 'user' ? colors.white : colors.text,
                  ...Typography.bodyRegular,
                }}
              >
                {entry.text}
              </Text>
            </View>
          ))}
        </View>

        {step === 'circle' ? (
          <View style={styles.choiceSection}>
            {availableCircles.length === 0 ? (
              <Text selectable style={[styles.empty, { color: colors.textSecondary }]}>
                {t('assistant.noCircle', {
                  defaultValue: '请先选择或加入一个圈子，再开启提醒。',
                })}
              </Text>
            ) : (
              availableCircles.map((circle) => {
                const context = circleContext(circle);
                return (
                  <Pressable
                    key={circle.id}
                    accessibilityRole="button"
                    onPress={() => handleCircleSelect(circle.id)}
                    style={[styles.choiceCard, { backgroundColor: colors.surface }]}
                  >
                    <View style={styles.choiceCopy}>
                      <Text style={[styles.choiceTitle, { color: colors.text }]}>
                        {context.name}
                      </Text>
                      <Text style={[styles.choiceSubtitle, { color: colors.textSecondary }]}>
                        {circleScopeText(
                          context,
                          t('assistant.allCities', { defaultValue: '不限城市' }),
                        )}
                      </Text>
                    </View>
                    <Text style={[styles.choiceAction, { color: colors.primary }]}>
                      {t('assistant.selectCircle', { defaultValue: '选择' })}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>
        ) : null}

        {step === 'keywords' ? (
          <View style={styles.choiceSection}>
            {selectedCircle ? (
              <Text selectable style={[styles.scopeHint, { color: colors.textSecondary }]}>
                {t('assistant.cityScope', {
                  defaultValue: '城市范围：{{cities}}',
                  cities: circleScopeText(
                    selectedCircle,
                    t('assistant.allCities', { defaultValue: '不限城市' }),
                  ),
                })}
              </Text>
            ) : null}
            <View style={styles.keywordInputRow}>
              <TextInput
                value={keywordDraft}
                onChangeText={setKeywordDraft}
                onSubmitEditing={addKeyword}
                placeholder={t('assistant.keywordPlaceholder', {
                  defaultValue: '例如：演唱会、招聘、展览',
                })}
                placeholderTextColor={colors.textSecondary}
                returnKeyType="done"
                style={[styles.keywordInput, { backgroundColor: colors.surface, color: colors.text }]}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!keywordDraft.trim()}
                onPress={addKeyword}
                style={[styles.addKeyword, { backgroundColor: colors.primary }]}
              >
                <Text style={{ color: colors.white, ...Typography.body }}>
                  {t('common.add', { defaultValue: '添加' })}
                </Text>
              </Pressable>
            </View>
            {keywords.length > 0 ? (
              <View style={styles.keywordList}>
                {keywords.map((keyword) => (
                  <Pressable
                    key={keyword}
                    accessibilityRole="button"
                    onPress={() =>
                      setKeywords((current) => current.filter((item) => item !== keyword))
                    }
                    style={[styles.keywordChip, { backgroundColor: colors.primaryLight }]}
                  >
                    <Text style={{ color: colors.primary, ...Typography.caption }}>{keyword} ×</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => continueToNoteStatus(false)}
              style={[styles.primaryAction, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.white, ...Typography.body }}>
                {keywords.length > 0 || keywordDraft.trim()
                  ? t('assistant.continue', { defaultValue: '继续' })
                  : t('assistant.allKeywordsButton', { defaultValue: '不限制关键词' })}
              </Text>
            </Pressable>
            {keywords.length > 0 || keywordDraft.trim() ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => continueToNoteStatus(true)}
                style={[styles.secondaryAction, { borderColor: colors.surfaceBorder }]}
              >
                <Text style={{ color: colors.textSecondary, ...Typography.body }}>
                  {t('assistant.allKeywordsButton', { defaultValue: '关注全部信息' })}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {step === 'note-status' ? (
          <View style={styles.choiceSection}>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => void handleNoteStatusChoice(true)}
              style={[styles.primaryAction, { backgroundColor: colors.primary }]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={{ color: colors.white, ...Typography.body }}>
                  {t('assistant.noteStatusYesButton', { defaultValue: '关注笔记下架动态' })}
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => void handleNoteStatusChoice(false)}
              style={[styles.secondaryAction, { borderColor: colors.surfaceBorder }]}
            >
              <Text style={{ color: colors.textSecondary, ...Typography.body }}>
                {t('assistant.noteStatusNoButton', { defaultValue: '暂时不用' })}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {error ? (
          <Text selectable style={[styles.inlineError, { color: colors.error }]}>{error}</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chatContainer: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  assistantHeader: { alignItems: 'center', flexDirection: 'row', gap: Spacing.md },
  headerCopy: { gap: 2 },
  headerTitle: { ...Typography.title, fontWeight: '700' },
  headerSubtitle: { ...Typography.caption },
  messages: { gap: Spacing.md },
  bubble: { borderRadius: Radius.lg, maxWidth: '86%', padding: Spacing.md },
  assistantBubble: { borderCurve: 'continuous' },
  userBubble: { borderCurve: 'continuous' },
  choiceSection: { gap: Spacing.sm },
  choiceCard: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: Radius.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  choiceCopy: { flex: 1, gap: 4 },
  choiceTitle: { ...Typography.body, fontWeight: '600' },
  choiceSubtitle: { ...Typography.caption },
  choiceAction: { ...Typography.caption, fontWeight: '600' },
  scopeHint: { ...Typography.caption },
  keywordInputRow: { alignItems: 'center', flexDirection: 'row', gap: Spacing.sm },
  keywordInput: {
    borderCurve: 'continuous',
    borderRadius: Radius.md,
    flex: 1,
    minHeight: 46,
    paddingHorizontal: Spacing.md,
    ...Typography.bodyRegular,
  },
  addKeyword: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: Radius.md,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: Spacing.md,
  },
  keywordList: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  keywordChip: { borderRadius: 999, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  primaryAction: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: Radius.md,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
  },
  secondaryAction: {
    alignItems: 'center',
    borderCurve: 'continuous',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
  },
  empty: { ...Typography.bodyRegular, textAlign: 'center' },
  loader: { marginTop: Spacing.lg },
  loading: { ...Typography.bodyRegular, marginTop: Spacing.sm },
  error: { ...Typography.bodyRegular, marginTop: Spacing.lg, textAlign: 'center' },
  inlineError: { ...Typography.caption },
  retry: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  retryText: { ...Typography.body, fontWeight: '600' },
});
