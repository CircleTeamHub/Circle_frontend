import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { ChatMediaFile } from '@/features/chat/chat-detail/types';
import { reportHandledFailure } from '@/observability/report-failure';

interface CompressedVideo extends ChatMediaFile {
  id: string;
  width: number;
  height: number;
  duration: number;
  fileSize: number;
}

interface ChatVideoCompressorModule {
  compress(uri: string): Promise<CompressedVideo | null>;
  release(id: string): Promise<void>;
}

export interface PreparedChatVideo {
  asset: ChatMediaFile;
  filename: string;
  contentType: string;
  cleanup?: () => Promise<void>;
}

function loadCompressor(): ChatVideoCompressorModule | null {
  if (Platform.OS === 'web') return null;
  // Existing binaries and Expo Go can still send; the native feature needs a new APK/IPA.
  return requireOptionalNativeModule<ChatVideoCompressorModule>('ChatVideoCompressor');
}

/** Whether picked videos get re-encoded before upload, so their size can only be judged afterwards. */
export function isChatVideoCompressionAvailable(): boolean {
  return loadCompressor() !== null;
}

/** Native validates the output and returns null when transcoding would not save bytes. */
export async function prepareChatVideoForUpload(
  asset: ChatMediaFile,
  filename: string,
  contentType: string,
): Promise<PreparedChatVideo> {
  const original = { asset, filename, contentType };
  const native = loadCompressor();
  if (!native) return original;
  try {
    const output = await native.compress(asset.uri);
    if (!output) return original;
    return {
      asset: { uri: output.uri, width: output.width, height: output.height, duration: output.duration, fileSize: output.fileSize },
      filename: `${filename.replace(/\.[^./]*$/, '') || 'video'}.mp4`,
      contentType: 'video/mp4',
      cleanup: async () => {
        try {
          await native.release(output.id);
        } catch {
          reportHandledFailure('chatMedia', 'videoCompressionCleanup', new Error('Video compression cleanup failed'));
        }
      },
    };
  } catch {
    // Native codec errors may contain local private paths. Record only a static diagnostic.
    reportHandledFailure('chatMedia', 'videoCompression', new Error('Video compression failed'));
    return original;
  }
}
