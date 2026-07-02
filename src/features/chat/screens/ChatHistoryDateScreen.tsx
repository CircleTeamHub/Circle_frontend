import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { MessageItem } from '@openim/rn-client-sdk';
import i18n from '@/i18n';
import { NavHeader } from '@/components/ui/nav-header';
import {
  formatChatHistoryTime,
  getChatHistoryMessageTitle,
  resolveChatHistoryRouteParams,
} from '@/features/chat/chat-history';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import { searchConversationMessagesByDate } from '@/im/client';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const PAGE_SIZE = 50;
const CALENDAR_COLUMNS = 7;
// Localized single-letter weekday headers (2023-01-01 is a Sunday).
function getWeekdayLabels(locale: string) {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' }),
  );
}

type CalendarDay = {
  key: string;
  label: string;
  date: string;
  isCurrentMonth: boolean;
  isToday: boolean;
};

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatCalendarMonthTitle(date: Date) {
  return date.toLocaleString(getLocalizedDateTimeLocale(i18n.language), {
    year: 'numeric',
    month: 'long',
  });
}

function buildCalendarDays(monthDate: Date): CalendarDay[] {
  const monthStart = getMonthStart(monthDate);
  const firstWeekday = monthStart.getDay();
  const start = new Date(monthStart);
  start.setDate(monthStart.getDate() - firstWeekday);

  const today = formatDateInput(new Date());
  return Array.from({ length: CALENDAR_COLUMNS * 6 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateValue = formatDateInput(date);
    return {
      key: dateValue,
      label: String(date.getDate()),
      date: dateValue,
      isCurrentMonth: date.getMonth() === monthStart.getMonth(),
      isToday: dateValue === today,
    };
  });
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  calendarCard: {
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayRow: {
    flexDirection: 'row',
  },
  weekdayCell: {
    width: `${100 / CALENDAR_COLUMNS}%`,
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: `${100 / CALENDAR_COLUMNS}%`,
    aspectRatio: 1,
    padding: 3,
  },
  calendarDayButton: {
    flex: 1,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  listContent: {
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  centeredText: {
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});

export default function ChatHistoryDateScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const weekdayLabels = getWeekdayLabels(getLocalizedDateTimeLocale(i18n.language));
  const params = useLocalSearchParams<{
    conversationID?: string;
    sourceID?: string;
    title?: string;
  }>();
  const { conversationID, sourceID, title } = resolveChatHistoryRouteParams(params);
  const [visibleMonth, setVisibleMonth] = useState(() => getMonthStart(new Date()));
  const [selectedDate, setSelectedDate] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [results, setResults] = useState<MessageItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const pageRef = useRef(1);
  const activeDateRef = useRef('');

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const calendarDays = useMemo(
    () => buildCalendarDays(visibleMonth),
    [visibleMonth],
  );

  const d = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      calendarCard: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      monthButton: {
        backgroundColor: colors.surfaceBorder,
      },
      monthTitle: { color: colors.text, ...Typography.body },
      weekdayText: { color: colors.textSecondary, ...Typography.small },
      dayText: { color: colors.text, ...Typography.bodyRegular },
      fadedDayText: { color: colors.textSecondary, ...Typography.bodyRegular },
      selectedDayButton: { backgroundColor: colors.primary },
      todayDayButton: {
        borderWidth: 1,
        borderColor: colors.primary,
      },
      selectedDayText: { color: colors.white, ...Typography.body },
      card: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.surfaceBorder,
      },
      title: { color: colors.text, ...Typography.body },
      meta: { color: colors.textSecondary, ...Typography.small },
      centeredText: { color: colors.textSecondary, ...Typography.bodyRegular },
      errorText: { color: colors.error, ...Typography.bodyRegular },
      retryButton: {
        marginTop: Spacing.md,
        alignSelf: 'center' as const,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.lg,
        backgroundColor: colors.primary,
      },
      retryText: { color: colors.white, ...Typography.body },
    }),
    [colors],
  );

  const searchDate = useCallback(
    async (nextDate: string, nextPage = 1) => {
      if (!conversationID || loading || (nextPage > 1 && loadingMore)) {
        return;
      }

      if (nextPage === 1) {
        setSearched(true);
        activeDateRef.current = nextDate;
        pageRef.current = 1;
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const page = await searchConversationMessagesByDate({
          conversationID,
          date: nextDate,
          pageIndex: nextPage,
          count: PAGE_SIZE,
        });

        if (mountedRef.current) {
          pageRef.current = nextPage;
          setResults((prev) => (nextPage === 1 ? page : [...prev, ...page]));
          setHasMore(page.length === PAGE_SIZE);
        }
      } catch (err) {
        if (mountedRef.current) {
          if (nextPage === 1) {
            setResults([]);
            setError(t('chat.history.loadFailed'));
          }
          setHasMore(false);
        }
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[chat-history-date] search failed', err);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [conversationID, loading, loadingMore, t],
  );

  const handleMonthOffset = useCallback((offset: number) => {
    setVisibleMonth((current) => {
      const next = new Date(current);
      next.setMonth(current.getMonth() + offset);
      return getMonthStart(next);
    });
  }, []);

  const handleSelectDate = useCallback(
    (day: CalendarDay) => {
      if (!day.isCurrentMonth) {
        setVisibleMonth(getMonthStart(new Date(`${day.date}T00:00:00`)));
      }
      setSelectedDate(day.date);
      void searchDate(day.date);
    },
    [searchDate],
  );

  const handleLoadMore = useCallback(() => {
    if (!hasMore || !activeDateRef.current) {
      return;
    }
    void searchDate(activeDateRef.current, pageRef.current + 1);
  }, [hasMore, searchDate]);

  const openMessage = useCallback((clientMsgID: string) => {
    if (!sourceID) {
      router.back();
      return;
    }

    router.push(getChatDetailHref('messages', sourceID, title, undefined, conversationID, clientMsgID));
  }, [conversationID, sourceID, title]);

  return (
    <View style={[s.container, d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('chat.history.dateTitle')}
        fallbackHref={getChatDetailHref('messages', sourceID, title, undefined, conversationID)}
      />
      <View style={s.content}>
        <View style={[s.calendarCard, d.calendarCard]}>
          <View style={s.calendarHeader}>
            <Pressable
              style={[s.monthButton, d.monthButton]}
              onPress={() => handleMonthOffset(-1)}
              accessibilityLabel={t('chat.history.prevMonth')}
            >
              <Ionicons name="chevron-back" size={18} color={colors.text} />
            </Pressable>
            <Text style={d.monthTitle}>
              {formatCalendarMonthTitle(visibleMonth)}
            </Text>
            <Pressable
              style={[s.monthButton, d.monthButton]}
              onPress={() => handleMonthOffset(1)}
              accessibilityLabel={t('chat.history.nextMonth')}
            >
              <Ionicons name="chevron-forward" size={18} color={colors.text} />
            </Pressable>
          </View>
          <View style={s.weekdayRow}>
            {weekdayLabels.map((label, index) => (
              <View key={index} style={s.weekdayCell}>
                <Text style={d.weekdayText}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={s.calendarGrid}>
            {calendarDays.map((day) => {
              const selected = day.date === selectedDate;
              return (
                <View key={day.key} style={s.calendarCell}>
                  <Pressable
                    style={[
                      s.calendarDayButton,
                      day.isToday && !selected ? d.todayDayButton : null,
                      selected ? d.selectedDayButton : null,
                    ]}
                    onPress={() => handleSelectDate(day)}
                  >
                    <Text
                      style={[
                        day.isCurrentMonth ? d.dayText : d.fadedDayText,
                        selected ? d.selectedDayText : null,
                      ]}
                    >
                      {day.label}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>

        <FlatList
          data={results}
          keyExtractor={(item) => item.clientMsgID}
          contentContainerStyle={s.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => (
            <Pressable style={[s.card, d.card]} onPress={() => openMessage(item.clientMsgID)}>
              <Text style={d.title}>{getChatHistoryMessageTitle(item)}</Text>
              <Text style={d.meta}>{formatChatHistoryTime(item.sendTime)}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            error ? (
              <View>
                <Text style={[s.centeredText, d.errorText]}>{error}</Text>
                <Pressable
                  style={d.retryButton}
                  onPress={() => activeDateRef.current && void searchDate(activeDateRef.current)}
                >
                  <Text style={d.retryText}>{t('chat.history.retry')}</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={[s.centeredText, d.centeredText]}>
                {searched
                  ? loading
                    ? t('chat.history.searching')
                    : t('chat.history.noRecordsForDate')
                  : t('chat.history.pickDate')}
              </Text>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <Text style={[s.centeredText, d.centeredText]}>
                {t('chat.history.loading')}
              </Text>
            ) : null
          }
        />
      </View>
    </View>
  );
}
