import { fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import type { ChatMessage } from '@/types';
import { FailedMessageRetry } from './FailedMessageRetry';

jest.mock('@/theme', () => ({ useTheme: () => ({ colors: { error: 'red' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const failed: ChatMessage = { id: 'local-1', type: 'sent', sendStatus: 3, deliveryId: 'd-1' };

test.each(['sent', 'image', 'video', 'voice', 'note-card', 'circle-card'] as const)(
  'failed outgoing %s has a separate retry target', (type) => {
    const onRetry = jest.fn();
    const onPreview = jest.fn();
    const message = { ...failed, type, outgoing: true };
    const view = render(
      <FailedMessageRetry message={message} onRetry={onRetry}>
        <Pressable onPress={onPreview}><Text>preview</Text></Pressable>
      </FailedMessageRetry>,
    );
    fireEvent.press(view.getByLabelText('chat.messageActions.retryFailed'));
    expect(onRetry).toHaveBeenCalledWith(message);
    expect(onPreview).not.toHaveBeenCalled();
    fireEvent.press(view.getByText('preview'));
    expect(onPreview).toHaveBeenCalledTimes(1);
  },
);

test('retry disappears while sending, returns on failure and disappears on success', () => {
  const onRetry = jest.fn();
  const row = (message: ChatMessage) => (
    <FailedMessageRetry message={message} onRetry={onRetry}><Text>message</Text></FailedMessageRetry>
  );
  const view = render(row(failed));
  expect(view.queryByRole('button')).toBeTruthy();
  view.rerender(row({ ...failed, sendStatus: 1 }));
  expect(view.queryByRole('button')).toBeNull();
  view.rerender(row(failed));
  expect(view.queryByRole('button')).toBeTruthy();
  view.rerender(row({ ...failed, sendStatus: 2 }));
  expect(view.queryByRole('button')).toBeNull();
});

test.each([
  { ...failed, deliveryId: undefined },
  { ...failed, type: 'received' as const, outgoing: false },
])('does not offer retry for an ineligible message', (message) => {
  const view = render(
    <FailedMessageRetry message={message} onRetry={jest.fn()}><Text>message</Text></FailedMessageRetry>,
  );
  expect(view.queryByRole('button')).toBeNull();
  expect(view.getByText('message')).toBeTruthy();
});


test('failed card retry does not add horizontal width on a 320 point screen', () => {
  const ui = render(<FailedMessageRetry message={{ ...failed, type: 'note-card', outgoing: true }} onRetry={jest.fn()}><View style={{ width: 260 }}><Text>card</Text></View></FailedMessageRetry>);
  const retry = ui.getByLabelText('chat.messageActions.retryFailed');
  expect(ui.UNSAFE_getAllByType(View).some(view => StyleSheet.flatten(view.props.style)?.flexDirection === 'column-reverse')).toBe(true);
  expect(retry).toBeTruthy();
  expect(ui.getByText('card')).toBeTruthy();
});
