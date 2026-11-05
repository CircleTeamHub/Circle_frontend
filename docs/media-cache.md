# Media download caching

Ordinary images, feed thumbnails, and video posters use expo-image's memory/disk cache. Private note covers use the immutable note/media IDs instead of a rotating signed URL. Feed thumbnails do not fetch a larger remote image as a placeholder. The full-screen image viewer only loads its active original image.

Ordinary remote videos use expo-video's existing persistent, range-based cache and its default bounded eviction. Opening a list does not download its videos; playback still starts on a tap. Local picker/file/blob sources and adaptive manifests retain the uncached path.

`src/utils/video-source.ts` preserves the complete authenticated network URL. Its separate cache key omits only COS/S3 signing parameters and retains the host, object path, object version, and transformation query parameters. `patches/expo-video+55.0.15.patch` adds this optional key to the Android/iOS cache plumbing, including iOS media metadata. The patch is reapplied by the existing patch-package postinstall step.

**Rebuild the native Android/iOS app after installing this change.** An OTA update alone cannot add the stable video cache-key support to an existing binary. Web continues to use the browser's HTTP cache and server cache headers.

Android autolinking explicitly builds `expo-video` from source. The production EAS profile disables precompiled Expo modules on iOS, ensuring the patched sources reach the binary. For local iOS builds that previously opted into precompiled modules, set `EXPO_USE_PRECOMPILED_MODULES=0` before installing pods.

Disappearing chat images/video posters retain their memory-only policy. Disappearing videos bypass persistent caching. On encountering a new disappearing-message policy, the existing sweep now clears both image and video disk caches; the media-policy marker is versioned separately from the former image-only marker so upgrades also perform the necessary video sweep. The native video clear waits until active players release their resources, and the marker is saved only after both clears succeed. A missing cache directory counts as an empty cache.

Cache eviction, manual cache clearing, or an OS storage cleanup can require another download. Caching reduces repeat views on the same device; first views and other users' downloads still incur provider traffic charges.

For device validation, open the same ordinary video twice, then refresh its signed URL and replay it. Compare received bytes in COS monitoring or a device network capture. Repeat with a disappearing video and confirm that it is not available from the persistent cache. No media URL or authentication token should be added to logs for this check.
