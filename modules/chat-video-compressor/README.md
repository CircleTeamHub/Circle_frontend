# Chat video compression

Local Expo module, auto-linked during prebuild on Android and iOS. Both platforms expose the same contract: `compress(uri)` resolves `{ id, uri, width, height, duration (ms), fileSize }` or `null`, and `release(id)` deletes an owned output.

## Android

Uses Media3 1.8.0, matching `expo-video`; keep the versions aligned.

- Encodes local files/content URIs as H.264/AAC MP4, with an even-sized long edge of at most 1280 px and a target video bitrate of at most 1.5 Mbps. It does not upscale or raise a known lower source bitrate.
- Skips files below 2 MiB and videos already within the size/bitrate target. Returns output only when it contains encoded video and is smaller than the source.
- Returns actual output display dimensions, duration in milliseconds, and byte size. The original outbox file remains available for retries.
- Outputs live in private cache storage. The sending hook releases them after upload and poster generation; module destruction cancels active exports and releases owned outputs.
- Codec failures fall back to the original file. JS diagnostics omit native error text and private paths.

Run profile tests from the generated Android project with `gradlew :chat-video-compressor:testDebugUnitTest`.

## iOS

The chat picks media from an in-app gallery (`expo-media-library`), which hands back the original file instead of the 720p export the system picker used to make. This module restores that export:

- `AVAssetExportSession` with `AVAssetExportPreset1280x720` into an MP4 under `Caches/chat-video-compressor/` (H.264, the same preset the picker applied), so HEVC/4K originals become playable on every Android device.
- Skips files below 2 MiB and sources that are already H.264 with a long edge of at most 1280 px. Returns output only when it is smaller than the source.
- Module destruction cancels active exports and deletes owned outputs.

The Swift code needs a Mac build to verify: pick a 4K HEVC clip in the chat gallery and check that the uploaded file is a 720p MP4.

## Fallbacks

Web and binaries without this module (Expo Go, older APK/IPA) upload the original file. In that case the 100 MB video limit is checked before upload; when the module is present it is checked on the compressed output. JS integration regressions live in `chat-video-compress.spec.tsx` and `use-media-send.spec.tsx`.
