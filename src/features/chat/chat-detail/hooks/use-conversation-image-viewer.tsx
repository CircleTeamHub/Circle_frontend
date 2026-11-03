import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageViewer } from '@/components/ui/image-viewer';
import { isEphemeralMessage } from '@/features/chat/utils/ephemeral-message';
import type { ChatMessage } from '@/types';

export function useConversationImageViewer(
  messages: ChatMessage[],
  selfDestructEnabled: boolean,
  selfDestructCacheKey: string,
  onImageViewed: (messageID: string) => void,
) {
  const [selectedID, setSelectedID] = useState<string | null>(null);
  // Timeline data is newest first; gallery pages follow the visible conversation chronology.
  const photos = useMemo(() => messages.filter(
    (message) => message.type === 'image' && (message.imageUrl || message.imageThumbUrl),
  ).reverse(), [messages]);
  const selectedIndex = photos.findIndex((message) => message.id === selectedID);
  const openImage = useCallback((message: ChatMessage) => {
    setSelectedID(message.id);
    onImageViewed(message.id);
  }, [onImageViewed]);
  const close = useCallback(() => setSelectedID(null), []);
  // An expired/deleted message must not reappear when another history page arrives.
  useEffect(() => {
    if (selectedID !== null && selectedIndex < 0) setSelectedID(null);
  }, [selectedID, selectedIndex]);
  useEffect(() => setSelectedID(null), [selfDestructCacheKey]);

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
