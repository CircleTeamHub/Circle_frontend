# Android chat video compression

Local Expo module, auto-linked during Android prebuild. It uses Media3 1.8.0, matching `expo-video`; keep the versions aligned.

- Encodes local files/content URIs as H.264/AAC MP4, with an even-sized long edge of at most 1280 px and a target video bitrate of at most 1.5 Mbps. It does not upscale or raise a known lower source bitrate.
- Skips files below 2 MiB and videos already within the size/bitrate target. Returns output only when it contains encoded video and is smaller than the source.
- Returns actual output display dimensions, duration in milliseconds, and byte size. The original outbox file remains available for retries.
- Outputs live in private cache storage. The sending hook releases them after upload and poster generation; module destruction cancels active exports and releases owned outputs.
- Codec failures fall back to the original file. JS diagnostics omit native error text and private paths.

This feature requires a new Android binary. iOS retains the picker export preset; web and binaries without this module retain their existing upload behavior.

Run profile tests from the generated Android project with `gradlew :chat-video-compressor:testDebugUnitTest`. JS integration regressions live in `chat-video-compress.spec.tsx` and `use-media-send.spec.tsx`.
