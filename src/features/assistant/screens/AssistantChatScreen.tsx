import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AssistantAvatar } from '@/features/assistant/components/AssistantAvatar';
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

function circleContext(circle: Circle): AssistantCircleContext {
  return { id: circle.id, name: circle.name, cities: circle.cities };
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const circles = useMemo(() => {
    const byId = new Map<string, Circle>();
    for (const circle of joinedCircles) byId.set(circle.id, circle);
    for (const circle of createdCircles) byId.set(circle.id, circle);
    return [...byId.values()];
  }, [createdCircles, joinedCircles]);

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
      setSelectedCircleId(next.contextCircle?.id ?? null);
      if (!next.contextCircle) void fetchMyCircles();
    } catch (cause) {
      reportHandledFailure('assistant', 'bootstrap', cause);
      setError(getApiErrorMessage(cause, t('common.networkError')));
    }
  }, [contextCircleId, fetchMyCircles, navigateToChat, t]);

  useEffect(() => {
    void openAssistant();
  }, [openAssistant]);

  const selectedCircle = useMemo<AssistantCircleContext | null>(() => {
    if (!selectedCircleId) return null;
    if (bootstrap?.contextCircle?.id === selectedCircleId) {
      return bootstrap.contextCircle;
    }
    const cached = circles.find((circle) => circle.id === selectedCircleId);
    return cached ? circleContext(cached) : null;
  }, [bootstrap?.contextCircle, circles, selectedCircleId]);

  const handleEnable = useCallback(async () => {
    if (!selectedCircleId || submitting || !bootstrap) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAssistantSubscription({ circleId: selectedCircleId });
      navigateToChat(bootstrap);
    } catch (cause) {
      reportHandledFailure('assistant', 'createSubscription', cause);
      setError(getApiErrorMessage(cause, t('common.networkError')));
    } finally {
      setSubmitting(false);
    }
  }, [bootstrap, navigateToChat, selectedCircleId, submitting, t]);

  if (error && !bootstrap) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <AssistantAvatar size={76} />
        <Text style={[styles.error, { color: colors.textSecondary }]}>
          {error}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void openAssistant()}
          style={[styles.retry, { borderColor: colors.primary }]}
        >
          <Text style={[styles.retryText, { color: colors.primary }]}>
            {t('common.retry')}
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
    <ScrollView
      contentContainerStyle={[
        styles.setupContainer,
        { paddingTop: insets.top + Spacing.xl },
      ]}
      style={{ backgroundColor: colors.background }}
    >
      <AssistantAvatar size={76} />
      <Text style={[styles.title, { color: colors.text }]}>
        {t('assistant.setupTitle', { defaultValue: '开启城市信息提醒' })}
      </Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {t('assistant.setupHint', {
          defaultValue: '选择一个圈子，风信助手会按照这个圈子的城市范围匹配新动态。',
        })}
      </Text>

      {selectedCircle ? (
        <View
          style={[styles.selectedCard, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.circleName, { color: colors.text }]}>
            {selectedCircle.name}
          </Text>
          <Text style={[styles.cityText, { color: colors.textSecondary }]}>
            {selectedCircle.cities.length > 0
              ? selectedCircle.cities.join('、')
              : t('assistant.allCities', { defaultValue: '不限城市' })}
          </Text>
        </View>
      ) : null}

      {!selectedCircle ? (
        <View style={styles.circleList}>
          {circles.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {t('assistant.noCircle', {
                defaultValue: '请先选择或加入一个圈子，再开启提醒。',
              })}
            </Text>
          ) : (
            circles.map((circle) => (
              <Pressable
                key={circle.id}
                onPress={() => setSelectedCircleId(circle.id)}
                style={[styles.circleOption, { borderColor: colors.surfaceBorder }]}
              >
                <View style={styles.circleOptionText}>
                  <Text style={[styles.circleName, { color: colors.text }]}>
                    {circle.name}
                  </Text>
                  <Text style={[styles.cityText, { color: colors.textSecondary }]}>
                    {circle.cities.length > 0
                      ? circle.cities.join('、')
                      : t('assistant.allCities', { defaultValue: '不限城市' })}
                  </Text>
                </View>
                <Text style={[styles.chooseText, { color: colors.primary }]}>
                  {t('assistant.selectCircle', { defaultValue: '选择' })}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      {error ? (
        <Text style={[styles.inlineError, { color: colors.error }]}>{error}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={!selectedCircleId || submitting}
        onPress={() => void handleEnable()}
        style={[
          styles.enableButton,
          {
            backgroundColor: selectedCircleId ? colors.primary : colors.surface,
            opacity: submitting ? 0.6 : 1,
          },
        ]}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text
            style={[
              styles.enableText,
              { color: selectedCircleId ? colors.white : colors.textSecondary },
            ]}
          >
            {t('assistant.enable', { defaultValue: '开启提醒' })}
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  setupContainer: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl * 2,
  },
  loader: { marginTop: Spacing.lg },
  loading: { ...Typography.bodyRegular, marginTop: Spacing.sm },
  title: { ...Typography.title, marginTop: Spacing.lg },
  description: {
    ...Typography.bodyRegular,
    marginTop: Spacing.sm,
    textAlign: 'center',
    lineHeight: 22,
  },
  selectedCard: {
    alignSelf: 'stretch',
    borderRadius: Radius.lg,
    marginTop: Spacing.xl,
    padding: Spacing.lg,
  },
  circleList: { alignSelf: 'stretch', marginTop: Spacing.xl, gap: Spacing.sm },
  circleOption: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  circleOptionText: { flex: 1, gap: 4 },
  circleName: { ...Typography.body, fontWeight: '600' },
  cityText: { ...Typography.caption },
  chooseText: { ...Typography.caption, fontWeight: '600' },
  empty: { ...Typography.bodyRegular, textAlign: 'center' },
  inlineError: { ...Typography.caption, marginTop: Spacing.md },
  enableButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: Radius.md,
    justifyContent: 'center',
    marginTop: Spacing.xl,
    minHeight: 48,
  },
  enableText: { ...Typography.body, fontWeight: '600' },
  error: { ...Typography.bodyRegular, marginTop: Spacing.lg, textAlign: 'center' },
  retry: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  retryText: { ...Typography.body, fontWeight: '600' },
});
