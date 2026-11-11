# Chat video compression

Local Expo module, auto-linked during prebuild on both platforms. Both implementations share one contract: `compress(uri)` returns `{ id, uri, width, height, duration, fileSize }` or `null`, and `release(id)` deletes an output this module created.

- Encodes local files as H.264/AAC MP4, with an even-sized long edge of at most 1280 px and a target video bitrate of at most 1.5 Mbps. It does not upscale or raise a known lower source bitrate.
- Skips files below 2 MiB and videos already within the size/bitrate target. Returns output only when it contains encoded video and is smaller than the source.
- Returns actual output display dimensions, duration in milliseconds, and byte size. The original outbox file remains available for retries.
- Outputs live in private cache/temporary storage. The sending hook releases them after upload and poster generation; module destruction releases owned outputs.
- Codec failures fall back to the original file. JS diagnostics omit native error text and private paths.

## Android

Uses Media3 1.8.0, matching `expo-video`; keep the versions aligned. Run profile tests from the generated Android project with `gradlew :chat-video-compressor:testDebugUnitTest`.

## iOS

The photo picker still exports videos with the 1280×720 H.264 preset, which turns 4K/HEVC/HDR library videos into SDR H.264 quickly but leaves the bitrate uncontrolled (often 5 Mbps or more). This module then re-encodes with `AVAssetReader`/`AVAssetWriter` to the shared 1.5 Mbps target, keeping the source rotation as the track transform and writing the `moov` atom first so recipients can start playback early. HDR sources are skipped rather than re-encoded to 8-bit. Encoding can fail while the app is in the background (no hardware encoder); the original is uploaded then.

`ios-check/` is a macOS harness for the transcoder (AVFoundation is shared):

```bash
cd modules/chat-video-compressor/ios-check
swiftc -swift-version 5 ../ios/VideoCompressionProfile.swift ../ios/ChatVideoTranscoder.swift main.swift -o /tmp/vc-check
/tmp/vc-check some-video.mov
```

Both platforms need a new native binary; an OTA update cannot add the module. Web and older binaries keep uploading the original. JS integration regressions live in `chat-video-compress.spec.tsx` and `use-media-send.spec.tsx`.
