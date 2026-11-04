import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SecurityQuestionsSettingsScreen from './SecurityQuestionsSettingsScreen';
import { fetchSecurityQuestions, setSecurityQuestions } from '@/services/api/auth';

const mockBack = jest.fn();
type PickerProps = { visible: boolean; options: { value: string }[]; onSelect: (value: string) => void };
let mockPicker: PickerProps | null = null;

jest.mock('expo-router', () => ({ router: { back: () => mockBack() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => {
  const tokens = jest.requireActual('@/theme/tokens');
  const palettes = jest.requireActual('@/theme/colors');
  return { ...tokens, useTheme: () => ({ colors: palettes.darkColors }) };
});
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/option-picker-sheet', () => ({
  OptionPickerSheet: (props: PickerProps) => {
    mockPicker = props;
    return null;
  },
}));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: () => 'failed' }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/auth', () => ({
  fetchSecurityQuestions: jest.fn(),
  setSecurityQuestions: jest.fn(),
}));

function pick(slot: number, questionKey: string) {
  fireEvent.press(screen.getByTestId(`security-question-picker-${slot}`));
  expect(mockPicker?.visible).toBe(true);
  act(() => mockPicker!.onSelect(questionKey));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPicker = null;
  jest.mocked(fetchSecurityQuestions).mockResolvedValue([]);
  jest.mocked(setSecurityQuestions).mockResolvedValue(undefined);
});

test('saves two chosen questions with their answers and the current password', async () => {
  render(<SecurityQuestionsSettingsScreen />);
  await waitFor(() => expect(fetchSecurityQuestions).toHaveBeenCalled());

  pick(0, 'bestFriendName');
  // 第二道题的候选里不再有第一道已选的题。
  fireEvent.press(screen.getByTestId('security-question-picker-1'));
  expect(mockPicker!.options.map((option) => option.value)).not.toContain('bestFriendName');
  act(() => mockPicker!.onSelect('primarySchool'));

  fireEvent.changeText(screen.getByTestId('security-question-answer-0'), ' 张三 ');
  fireEvent.changeText(screen.getByTestId('security-question-answer-1'), '阳光小学');
  fireEvent.changeText(screen.getByTestId('security-questions-password'), 'password1');
  await act(async () => {
    fireEvent.press(screen.getByTestId('security-questions-save'));
  });

  expect(setSecurityQuestions).toHaveBeenCalledWith({
    password: 'password1',
    questions: [
      { questionKey: 'bestFriendName', answer: '张三' },
      { questionKey: 'primarySchool', answer: '阳光小学' },
    ],
  });
  expect(mockBack).toHaveBeenCalled();
});

test('asks for both questions and answers before calling the server', async () => {
  render(<SecurityQuestionsSettingsScreen />);
  await waitFor(() => expect(fetchSecurityQuestions).toHaveBeenCalled());
  pick(0, 'birthCity');
  fireEvent.changeText(screen.getByTestId('security-question-answer-0'), '杭州');
  fireEvent.changeText(screen.getByTestId('security-questions-password'), 'password1');
  await act(async () => {
    fireEvent.press(screen.getByTestId('security-questions-save'));
  });

  expect(screen.getByText('securityQuestions.incomplete')).toBeTruthy();
  expect(setSecurityQuestions).not.toHaveBeenCalled();
});

test('preselects the questions already set and explains that saving replaces them', async () => {
  jest.mocked(fetchSecurityQuestions).mockResolvedValue(['birthCity', 'firstPetName']);
  render(<SecurityQuestionsSettingsScreen />);

  expect(await screen.findByText('securityQuestions.introReplace')).toBeTruthy();
  expect(screen.getByText('securityQuestions.questions.birthCity')).toBeTruthy();
  expect(screen.getByText('securityQuestions.questions.firstPetName')).toBeTruthy();
});

test('a slow status response does not wipe what the user already filled in', async () => {
  let resolveStatus!: (keys: string[]) => void;
  jest.mocked(fetchSecurityQuestions).mockReturnValue(
    new Promise((resolve) => {
      resolveStatus = resolve as (keys: string[]) => void;
    }) as never,
  );
  render(<SecurityQuestionsSettingsScreen />);
  pick(0, 'bestFriendName');
  fireEvent.changeText(screen.getByTestId('security-question-answer-0'), '张三');

  await act(async () => {
    resolveStatus(['birthCity', 'firstPetName']);
  });

  expect(screen.getByText('securityQuestions.questions.bestFriendName')).toBeTruthy();
  expect(screen.getByTestId('security-question-answer-0').props.value).toBe('张三');
  expect(screen.getByText('securityQuestions.introReplace')).toBeTruthy();
});
