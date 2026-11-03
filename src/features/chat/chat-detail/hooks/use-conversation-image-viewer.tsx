import { useCallback, useEffect, useMemo, useState } from 'react';
import { messageRowKey } from '@/chat-core/local-message-id';
import { ImageViewer } from '@/components/ui/image-viewer';
import { isEphemeralMessage } from '@/features/chat/utils/ephemeral-message';
import type { ChatMessage } from '@/types';

export function useConversationImageViewer(
  messages: ChatMessage[],
  selfDestructEnabled: boolean,
  selfDestructCacheKey: string,
  onImageViewed: (messageID: string) => void,
) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Timeline data is newest first; gallery pages follow the visible conversation chronology.
  const photos = useMemo(() => messages.filter(
    (message) => message.type === 'image' && (message.imageUrl || message.imageThumbUrl),
  ).reverse(), [messages]);
  const selectedIndex = photos.findIndex((message) => messageRowKey(message) === selectedKey);
  const openImage = useCallback((message: ChatMessage) => {
    setSelectedKey(messageRowKey(message));
    onImageViewed(message.id);
  }, [onImageViewed]);
  const close = useCallback(() => setSelectedKey(null), []);
  // An expired/deleted message must not reappear when another history page arrives.
  useEffect(() => {
    if (selectedKey !== null && selectedIndex < 0) setSelectedKey(null);
  }, [selectedKey, selectedIndex]);
  useEffect(() => setSelectedKey(null), [selfDestructCacheKey]);

  const imageViewer = selectedIndex < 0 ? null : (
    <ImageViewer
      images={photos.map((message) => (message.imageUrl ?? message.imageThumbUrl)!)}
      cacheKeys={photos.map((message) => {
        const uri = (message.imageUrl ?? message.imageThumbUrl)!;
        return /^(?:file|content|ph|assets-library|data|blob):/i.test(uri)
          ? undefined
          : message.imageUrl ? message.imageKey : message.imageThumbKey;
      })}
      privacyModes={photos.map((message) => isEphemeralMessage(message, selfDestructEnabled) ? 'ephemeral' : 'standard')}
      initialIndex={selectedIndex}
      visible
      onIndexChange={(index) => openImage(photos[index])}
      onClose={close}
    />
  );
  return { imageViewer, openImage };
}
