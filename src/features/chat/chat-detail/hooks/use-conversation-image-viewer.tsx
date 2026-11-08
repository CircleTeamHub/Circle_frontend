import { useCallback, useEffect, useMemo, useState } from 'react';
import { messageRowKey } from '@/chat-core/local-message-id';
import { ImageViewer } from '@/components/ui/image-viewer';
import { isEphemeralMessage } from '@/features/chat/utils/ephemeral-message';
import type { ChatMessage } from '@/types';

/** 视频页这里放封面（没有封面是空串）；ImageViewer 按 videos 区分两种页。 */
function viewerUri(message: ChatMessage): string {
  return message.type === 'video' ? message.videoThumbUrl ?? '' : (message.imageUrl ?? message.imageThumbUrl)!;
}

function viewerCacheKey(message: ChatMessage): string | undefined {
  if (/^(?:file|content|ph|assets-library|data|blob):/i.test(viewerUri(message))) return undefined;
  if (message.type === 'video') return message.videoThumbKey;
  return message.imageUrl ? message.imageKey : message.imageThumbKey;
}

export function useConversationImageViewer(
  messages: ChatMessage[],
  selfDestructEnabled: boolean,
  selfDestructCacheKey: string,
  onImageViewed: (messageID: string) => void,
) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Timeline data is newest first; gallery pages follow the visible conversation chronology.
  const items = useMemo(() => messages.filter((message) => (
    message.type === 'video' ? message.videoUrl : message.type === 'image' && (message.imageUrl || message.imageThumbUrl)
  )).reverse(), [messages]);
  const selectedIndex = items.findIndex((message) => messageRowKey(message) === selectedKey);
  const openMedia = useCallback((message: ChatMessage) => {
    setSelectedKey(messageRowKey(message));
    onImageViewed(message.id);
  }, [onImageViewed]);
  const close = useCallback(() => setSelectedKey(null), []);
  // An expired/deleted message must not reappear when another history page arrives.
  useEffect(() => {
    if (selectedKey !== null && selectedIndex < 0) setSelectedKey(null);
  }, [selectedKey, selectedIndex]);
  // Burn policy changes also close playback so the video cache sweep can run once the player is released.
  useEffect(() => setSelectedKey(null), [selfDestructCacheKey, selfDestructEnabled]);

  const imageViewer = selectedIndex < 0 ? null : (
    <ImageViewer
      images={items.map(viewerUri)}
      cacheKeys={items.map(viewerCacheKey)}
      videos={items.map((message) => (message.type === 'video' ? message.videoUrl : undefined))}
      autoPlayInitialVideo={items[selectedIndex].type === 'video'}
      privacyModes={items.map((message) => isEphemeralMessage(message, selfDestructEnabled) ? 'ephemeral' : 'standard')}
      initialIndex={selectedIndex}
      visible
      onIndexChange={(index) => openMedia(items[index])}
      onClose={close}
    />
  );
  return { imageViewer, openMedia };
}
