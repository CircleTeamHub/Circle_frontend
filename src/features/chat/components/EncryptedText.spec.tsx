import { act, render, screen } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { EncryptedText } from './EncryptedText';
import { decryptText } from '@/services/e2ee/client';
import type { ChatMessage } from '@/types';
let mockEpoch = 1;
let mockFocus: () => void;
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: () => void) => { mockFocus = effect; } }));
jest.mock('@/services/e2ee/client', () => ({ decryptText: jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (s: { sessionEpoch: number }) => unknown) => select({ sessionEpoch: mockEpoch }), { getState: () => ({ sessionEpoch: mockEpoch }) }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const message = { id: 'message', type: 'received', encryptedContent: { envelope: { ciphertext: 'cipher' }, signature: 'proof' } } as ChatMessage;
const bubble = (m: ChatMessage) => <Text>{m.text}</Text>;
beforeEach(() => { Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true }); mockEpoch = 1; jest.clearAllMocks(); });
it('renders decrypted text only in the mounted bubble without modifying the stored message', async () => {
  (decryptText as jest.Mock).mockResolvedValue({ text: 'private text' });
  render(<EncryptedText message={message}>{bubble}</EncryptedText>);
  expect(await screen.findByText('private text')).toBeTruthy();
  expect(message.text).toBeUndefined();
  expect(JSON.stringify(message)).not.toContain('private text');
});
it('does not reveal a previous account result after session changes', async () => {
  let resolve!: (v: unknown) => void;
  (decryptText as jest.Mock).mockReturnValueOnce(new Promise(r => { resolve = r; })).mockReturnValue(new Promise(() => {}));
  const view = render(<EncryptedText message={message}>{bubble}</EncryptedText>);
  mockEpoch = 2;
  view.rerender(<EncryptedText message={message}>{bubble}</EncryptedText>);
  await act(async () => resolve({ text: 'old account secret' }));
  expect(screen.queryByText('old account secret')).toBeNull();
  view.unmount();
});
it('discards a decryption result after unmount', async () => {
  let resolve!: (v: unknown) => void;
  (decryptText as jest.Mock).mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(<EncryptedText message={message}>{bubble}</EncryptedText>);
  view.unmount();
  await act(async () => resolve({ text: 'late secret' }));
  expect(message.text).toBeUndefined();
});

it('retries a failed bubble when chat regains focus after key recovery', async () => {
 (decryptText as jest.Mock).mockRejectedValueOnce(new Error('missing key')).mockResolvedValue({text:'restored'});
 render(<EncryptedText message={message}>{bubble}</EncryptedText>);
 await screen.findByText('e2ee.unlockRequired');
 act(() => mockFocus());
 expect(await screen.findByText('restored')).toBeTruthy();
});
