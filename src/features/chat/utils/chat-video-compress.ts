import { requireOptionalNativeModule } from 'expo';
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

/** Native validates the output and returns null when transcoding would not save bytes. */
export async function prepareChatVideoForUpload(
  asset: ChatMediaFile,
  filename: string,
  contentType: string,
): Promise<PreparedChatVideo> {
  const original = { asset, filename, contentType };
  const native = requireOptionalNativeModule<ChatVideoCompressorModule>('ChatVideoCompressor');
  // Web, Expo Go and binaries built before the module existed still send the original.
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
