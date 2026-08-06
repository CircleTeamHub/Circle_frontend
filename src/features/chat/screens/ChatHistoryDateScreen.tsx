import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { NavHeader } from '@/components/ui/nav-header';
import { resolveChatHistoryRouteParams } from '@/features/chat/chat-history';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import { fetchChatMessageDays } from '@/chat-core/api';
import {
  getChatDetailHref,
  getChatHistoryDateResultsHref,
} from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const CALENDAR_COLUMNS = 7;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

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

// 把 42 天切成 6 周（每周 7 天），供「每周一行」渲染。
function chunkWeeks(days: CalendarDay[]): CalendarDay[][] {
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += CALENDAR_COLUMNS) {
    weeks.push(days.slice(i, i + CALENDAR_COLUMNS));
  }
  return weeks;
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
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  // 按周分行：容器纵向堆叠 6 个 weekRow。不用 flexWrap + 百分比宽度——RN 亚像素
  // 取整会让 7 个百分比格子累计略超 100%，第 7 格（周六）被挤到下一行，结果每行
  // 只剩 6 格、周六列全空、当月日期整体错位到左边一列。
  calendarGrid: {},
  weekRow: {
    flexDirection: 'row',
  },
  calendarCell: {
    flex: 1,
    aspectRatio: 1,
    padding: 3,
  },
  calendarDayButton: {
    flex: 1,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 「这天有聊天记录」的圆点：绝对定位在日期数字下方居中，不挤动数字。
  recordDotWrap: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  recordDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  hint: {
    textAlign: 'center',
    marginTop: Spacing.sm,
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
  // 当前可见月份里「有聊天记录」的日期集合（'YYYY-MM-DD'），用于给这些天上色。
  const [recordDays, setRecordDays] = useState<Set<string>>(() => new Set());
  const mountedRef = useRef(true);
  const recordsRequestRef = useRef('');

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const calendarDays = useMemo(
    () => buildCalendarDays(visibleMonth),
    [visibleMonth],
  );
  const calendarWeeks = useMemo(() => chunkWeeks(calendarDays), [calendarDays]);

  // 翻到某月就拉取该月有记录的日子。recordsRequestRef 做竞态防护：快速翻月时
  // 只让最新一次请求的结果落地，避免旧月覆盖新月的圆点。
  useEffect(() => {
    if (!conversationID) {
      setRecordDays(new Set());
      return;
    }
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const monthKey = `${year}-${month}`;
    recordsRequestRef.current = monthKey;
    void fetchChatMessageDays(conversationID, year, month)
      .then((days) => {
        if (!mountedRef.current || recordsRequestRef.current !== monthKey) return;
        setRecordDays(new Set(days));
      })
      .catch((err) => {
        if (isDev) {
          console.warn('[chat-history-date] load month records failed', err);
        }
      });
  }, [conversationID, visibleMonth]);

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
      todayDayButton: {
        borderWidth: 1,
        borderColor: colors.primary,
      },
      recordDot: { backgroundColor: colors.primary },
      centeredText: { color: colors.textSecondary, ...Typography.bodyRegular },
    }),
    [colors],
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
        // 点相邻月份的日子：先把日历翻到那个月，再让用户点当月的它。
        setVisibleMonth(getMonthStart(new Date(`${day.date}T00:00:00`)));
        return;
      }
      // 点当月某天 → 进入「当天聊天记录」结果页（结果页自己做精确的当日搜索，
      // 因此即便圆点索引偶有遗漏，点进去仍能查到当天记录）。
      router.push(
        getChatHistoryDateResultsHref(conversationID, sourceID, title, day.date),
      );
    },
    [conversationID, sourceID, title],
  );

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
            {calendarWeeks.map((week, weekIndex) => (
              <View key={weekIndex} style={s.weekRow}>
                {week.map((day) => {
                  const hasRecords =
                    day.isCurrentMonth && recordDays.has(day.date);
                  return (
                    <View key={day.key} style={s.calendarCell}>
                      <Pressable
                        style={[
                          s.calendarDayButton,
                          day.isToday ? d.todayDayButton : null,
                        ]}
                        onPress={() => handleSelectDate(day)}
                        accessibilityLabel={
                          hasRecords
                            ? `${day.label}, ${t('chat.history.hasRecordsA11y')}`
                            : undefined
                        }
                      >
                        <Text
                          style={day.isCurrentMonth ? d.dayText : d.fadedDayText}
                        >
                          {day.label}
                        </Text>
                        {hasRecords ? (
                          <View style={s.recordDotWrap} pointerEvents="none">
                            <View style={[s.recordDot, d.recordDot]} />
                          </View>
                        ) : null}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        <Text style={[s.hint, d.centeredText]}>{t('chat.history.pickDate')}</Text>
      </View>
    </View>
  );
}
