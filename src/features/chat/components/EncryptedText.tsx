import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { decryptText } from '@/services/e2ee/client';
import type { ChatMessage } from '@/types';

// Plaintext stays in the mounted bubble, never in the persisted chat store.
export function EncryptedText({ message, children }: { message: ChatMessage; children: (value: ChatMessage) => ReactElement }) {
  const { t } = useTranslation();
  const epoch = useAuthStore(s => s.sessionEpoch);
  const [value, setValue] = useState<{ epoch: number; id: string; text: string; quote?: string }>();
  const [focusRevision, setFocusRevision] = useState(0);
  useFocusEffect(useCallback(() => { setFocusRevision(v => v + 1); }, []));
  const [failed, setFailed] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { setForeground(state === 'active'); if (state !== 'active') setValue(undefined); });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let current = true;
    setValue(undefined); setFailed(false);
    if (foreground && message.encryptedContent) void decryptText(message.encryptedContent, message.sendStatus === 1 || message.sendStatus === 3).then(body => {
      if (current && useAuthStore.getState().sessionEpoch === epoch) setValue({ epoch, id: message.id, text: typeof body.text === 'string' ? body.text : '', quote: typeof body.quotedText === 'string' ? body.quotedText : undefined });
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [epoch, foreground, focusRevision, message.id, message.encryptedContent, message.sendStatus]);
  const visible = foreground && value?.epoch === epoch && value.id === message.id ? value : undefined;
  return children({ ...message, text: visible?.text ?? t(failed ? 'e2ee.unlockRequired' : 'e2ee.encryptedText'), quotedText: visible?.quote });
}
