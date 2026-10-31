import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import CreditScoreScreen from './CreditScoreScreen';
import { fetchCreditEvents, type CreditEvent } from '@/services/api/credit';

const mockAuthState = {
  user: { creditScore: 82 } as { creditScore?: number },
  sessionEpoch: 1,
};
let mockFocusCallback: (() => void | (() => void)) | null = null;

const RULE_LISTS: Record<string, string[]> = {
  'credit.improveRules': ['improve-rule'],
  'credit.deductRules': ['deduct-rule'],
  'credit.impacts': ['impact-rule'],
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.returnObjects) return RULE_LISTS[key] ?? key;
      const params = Object.entries(options ?? {})
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',');
      return params ? `${key}(${params})` : key;
    },
    i18n: { language: 'zh' },
  }),
}));

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusCallback = callback;
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

// 主题 provider 会读持久化的主题偏好；这里用不到，桩掉原生存储。
jest.mock('@/storage', () => ({
  storage: { getString: jest.fn(), set: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

// NavHeader 依赖 expo-router 的导航上下文；这里只把右侧动作原样渲染出来。
jest.mock('@/components/ui/nav-header', () => ({
  NavHeader: ({ title, rightSlot }: { title: string; rightSlot?: React.ReactNode }) => {
    const { Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <View>
        <Text>{title}</Text>
        {rightSlot}
      </View>
    );
  },
}));

jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
}));

jest.mock('@/services/api/credit', () => ({
  fetchCreditEvents: jest.fn(),
}));

jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

const mockFetchCreditEvents = jest.mocked(fetchCreditEvents);

const deduction: CreditEvent = {
  id: 'event-1',
  delta: -5,
  scoreAfter: 95,
  reason: 'FRIEND_REPORT',
  category: 'harassment',
  createdAt: '2026-10-30T08:00:00.000Z',
};

describe('CreditScoreScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.user = { creditScore: 82 };
    mockAuthState.sessionEpoch = 1;
    mockFocusCallback = null;
    mockFetchCreditEvents.mockResolvedValue([]);
  });

  it('shows the score, tier and distance to the next tier without the rules', async () => {
    render(<CreditScoreScreen />);

    expect(screen.getByText('82')).toBeTruthy();
    expect(screen.getByText('credit.tier.good.title')).toBeTruthy();
    expect(
      screen.getByText('credit.toNext(title=credit.tier.excellent.title,points=8)'),
    ).toBeTruthy();
    expect(await screen.findByText('credit.recentEmpty')).toBeTruthy();
    expect(screen.queryByText('improve-rule')).toBeNull();
    expect(screen.queryByText('credit.introTitle')).toBeNull();
  });

  it('opens the intro sheet with tiers and every rule list from the header button', async () => {
    render(<CreditScoreScreen />);
    await screen.findByText('credit.recentEmpty');

    fireEvent.press(screen.getByTestId('credit-intro-button'));

    expect(screen.getByText('credit.introTitle')).toBeTruthy();
    expect(screen.getByText('credit.introNote')).toBeTruthy();
    expect(screen.getByText('credit.range(min=90,max=100)')).toBeTruthy();
    expect(screen.getByText('credit.range(min=0,max=59)')).toBeTruthy();
    // 当前档位（82 分 = 良好）在档位列表里带「当前」标记，且只标一处。
    expect(screen.getAllByText('credit.currentTag')).toHaveLength(1);
    expect(screen.getByText('improve-rule')).toBeTruthy();
    expect(screen.getByText('deduct-rule')).toBeTruthy();
    expect(screen.getByText('impact-rule')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('common.close'));
    expect(screen.queryByText('credit.introTitle')).toBeNull();
  });

  it('clamps out-of-range scores and shows the top-tier message at 100', async () => {
    mockAuthState.user = { creditScore: 140 };
    render(<CreditScoreScreen />);

    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('credit.tier.excellent.title')).toBeTruthy();
    expect(screen.getByText('credit.maxReached')).toBeTruthy();
    await screen.findByText('credit.recentEmpty');
  });

  it('lists real credit changes with reason, report category, delta and resulting score', async () => {
    mockFetchCreditEvents.mockResolvedValue([
      deduction,
      { ...deduction, id: 'event-0', delta: 2, scoreAfter: 100, reason: 'NEW_SOURCE', category: null },
    ]);
    render(<CreditScoreScreen />);

    expect(
      await screen.findByText(
        'credit.reasons.friendReport · chat.report.categories.harassment.label',
      ),
    ).toBeTruthy();
    expect(screen.getByText('-5')).toBeTruthy();
    expect(screen.getByText('credit.scoreAfter(score=95)')).toBeTruthy();
    // 不认识的来源不露出原始枚举，按「信誉值调整」展示；加分带正号。
    expect(screen.getByText('credit.reasons.other')).toBeTruthy();
    expect(screen.queryByText(/NEW_SOURCE/)).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.queryByText('credit.recentEmpty')).toBeNull();
  });

  it('shows a retry action when the first load fails and recovers on retry', async () => {
    mockFetchCreditEvents.mockRejectedValueOnce(new Error('network down'));
    render(<CreditScoreScreen />);

    fireEvent.press(await screen.findByText('common.retry'));

    expect(await screen.findByText('credit.recentEmpty')).toBeTruthy();
    expect(screen.queryByText('credit.recentLoadFailed')).toBeNull();
    expect(screen.queryByText(/network down/)).toBeNull();
    expect(mockFetchCreditEvents).toHaveBeenCalledTimes(2);
  });

  it('does not refetch on refocus until the score changes', async () => {
    const { rerender } = render(<CreditScoreScreen />);
    await screen.findByText('credit.recentEmpty');
    expect(mockFetchCreditEvents).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockFocusCallback?.();
    });
    expect(mockFetchCreditEvents).toHaveBeenCalledTimes(1);

    // 实时推送把新分数写进 authStore 之后，下一次回到页面必须重拉。
    mockAuthState.user = { creditScore: 77 };
    rerender(<CreditScoreScreen />);
    await act(async () => {
      mockFocusCallback?.();
    });
    expect(mockFetchCreditEvents).toHaveBeenCalledTimes(2);
  });
});
