import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import SelectCircleScreen from './SelectCircleScreen';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';

const mockRouter = { back: jest.fn() };
const mockFetchMyCircles = jest.fn();
let mockFocusCallback: (() => void) | null = null;
let mockCommittedAtBack: { id: string; name: string }[] | null = null;

const mockCircles = [
  { id: 'circle-a', name: 'Circle A', description: '', avatarUrl: null },
  { id: 'circle-b', name: 'Circle B', description: '', avatarUrl: null },
];

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      if (key === 'plaza.circlePicker.selectedCount') {
        return `selected:${options?.count ?? 0}`;
      }
      return options?.defaultValue ?? key;
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => (
      <Text accessibilityLabel={`icon:${name}`}>{name}</Text>
    ),
  };
});

jest.mock('@/theme', () => ({
  Radius: { sm: 4, full: 999 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  Typography: { caption: {}, body: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      primary: '#6200ee',
      white: '#fff',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => {
  const { Pressable, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NavHeader: () => (
      <Pressable accessibilityLabel="back" onPress={mockRouter.back}>
        <Text>Back</Text>
      </Pressable>
    ),
  };
});

jest.mock('@/components/ui/circle-avatar', () => ({ CircleAvatar: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));

jest.mock('@/features/discover/store/use-circles-store', () => ({
  useCirclesStore: (selector: (state: unknown) => unknown) =>
    selector({
      joinedCircles: [mockCircles[1]],
      createdCircles: [mockCircles[0]],
      myCirclesLoading: false,
      myCirclesError: null,
      fetchMyCircles: mockFetchMyCircles,
    }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
  mockCommittedAtBack = null;
  usePostFormStore.setState({
    selectedCircles: [{ id: 'circle-a', name: 'Circle A' }],
  });
  mockRouter.back.mockImplementation(() => {
    mockCommittedAtBack = usePostFormStore.getState().selectedCircles;
  });
});

test('ordinary back abandons staged circle edits', () => {
  render(<SelectCircleScreen />);

  fireEvent.press(screen.getByText('Circle B'));
  expect(screen.getByText('selected:2')).toBeTruthy();
  expect(usePostFormStore.getState().selectedCircles).toEqual([
    { id: 'circle-a', name: 'Circle A' },
  ]);

  fireEvent.press(screen.getByLabelText('back'));

  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(usePostFormStore.getState().selectedCircles).toEqual([
    { id: 'circle-a', name: 'Circle A' },
  ]);
});

test('empty draft disables confirmation without changing the committed selection', () => {
  render(<SelectCircleScreen />);

  fireEvent.press(screen.getByText('Circle A'));

  expect(screen.getByText('selected:0')).toBeTruthy();
  expect(screen.queryAllByLabelText('icon:checkmark-circle')).toHaveLength(0);
  let confirmButton = screen.getByText('确定').parent;
  while (confirmButton && confirmButton.props.accessibilityState === undefined) {
    confirmButton = confirmButton.parent;
  }
  expect(confirmButton?.props.accessibilityState).toEqual(
    expect.objectContaining({ disabled: true }),
  );

  fireEvent.press(confirmButton!);
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(usePostFormStore.getState().selectedCircles).toEqual([
    { id: 'circle-a', name: 'Circle A' },
  ]);
});

test('refocus resets an abandoned draft and confirm commits only the fresh draft', () => {
  render(<SelectCircleScreen />);

  expect(screen.getAllByLabelText('icon:checkmark-circle')).toHaveLength(1);
  fireEvent.press(screen.getByText('Circle B'));
  expect(screen.getByText('selected:2')).toBeTruthy();
  expect(screen.getAllByLabelText('icon:checkmark-circle')).toHaveLength(2);

  act(() => {
    mockFocusCallback?.();
  });
  expect(screen.getByText('selected:1')).toBeTruthy();

  fireEvent.press(screen.getByText('Circle B'));
  fireEvent.press(screen.getByText('确定'));

  expect(usePostFormStore.getState().selectedCircles).toEqual([
    { id: 'circle-a', name: 'Circle A' },
    { id: 'circle-b', name: 'Circle B' },
  ]);
  expect(mockCommittedAtBack).toEqual([
    { id: 'circle-a', name: 'Circle A' },
    { id: 'circle-b', name: 'Circle B' },
  ]);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
