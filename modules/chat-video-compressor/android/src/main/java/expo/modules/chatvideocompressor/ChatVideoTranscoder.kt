package expo.modules.chatvideocompressor

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import java.io.File
import java.util.UUID
import kotlin.coroutines.coroutineContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

@androidx.annotation.OptIn(UnstableApi::class)
internal class ChatVideoTranscoder(context: Context) {
  private val context = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  // Accessed only on the main dispatcher, including close and codec callbacks.
  private val running = mutableMapOf<String, () -> Unit>()
  private val outputs = mutableMapOf<String, File>()
  private var closed = false

  private data class Metadata(val width: Int, val height: Int, val rotation: Int, val bitrate: Int, val duration: Long)

  private fun metadata(uri: Uri): Metadata {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      return Metadata(
        width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0,
        height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0,
        rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0,
        bitrate = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull() ?: 0,
        duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0,
      )
    } finally {
      retriever.release()
    }
  }

  suspend fun compress(source: String): Map<String, Any>? {
    val uri = Uri.parse(source)
    // Never let this local optimization turn a media URL into another network download.
    if (uri.scheme != "file" && uri.scheme != "content") return null
    val (input, profile, inputSize) = withContext(Dispatchers.IO) {
      val size = if (uri.scheme == "file") File(requireNotNull(uri.path)).length()
      else context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1
      if (size <= 0) return@withContext Triple(null, null, size)
      val info = metadata(uri)
      Triple(info, videoCompressionProfile(info.width, info.height, info.rotation, info.bitrate, size), size)
    }
    if (input == null || profile == null) return null

    return withContext(Dispatchers.Main.immediate) {
      check(!closed) { "Video compressor is closed" }
      val id = UUID.randomUUID().toString()
      val directory = File(context.cacheDir, "chat-video-compression").apply { mkdirs() }
      val output = File(directory, "$id.mp4")
      var retained = false
      try {
        val result = suspendCancellableCoroutine<ExportResult> { continuation ->
          val encoder = DefaultEncoderFactory.Builder(context)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(profile.bitrate).build())
            .build()
          val transformer = Transformer.Builder(context)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoder)
            .addListener(object : Transformer.Listener {
              override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                running.remove(id)
                if (continuation.isActive) continuation.resume(exportResult)
              }

              override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                running.remove(id)
                if (continuation.isActive) continuation.resumeWithException(IllegalStateException("Video encoding failed"))
              }
            })
            .build()
          running[id] = { continuation.cancel(CancellationException("Video compressor closed")) }
          continuation.invokeOnCancellation {
            main.post {
              running.remove(id)
              transformer.cancel()
              output.delete()
            }
          }
          val item = EditedMediaItem.Builder(MediaItem.fromUri(uri))
            .setEffects(Effects(emptyList(), listOf(Presentation.createForWidthAndHeight(profile.width, profile.height, Presentation.LAYOUT_SCALE_TO_FIT))))
            .build()
          try {
            transformer.start(item, output.absolutePath)
          } catch (_: Exception) {
            running.remove(id)
            transformer.cancel()
            if (continuation.isActive) continuation.resumeWithException(IllegalStateException("Video encoding could not start"))
          }
        }
        coroutineContext.ensureActive()
        val size = output.length()
        if (result.videoFrameCount <= 0 || size <= 0 || size >= inputSize) return@withContext null
        // Read display orientation and duration from the actual MP4, not the picker source.
        val finalMetadata = withContext(Dispatchers.IO) { metadata(Uri.fromFile(output)) }
        coroutineContext.ensureActive()
        check(!closed) { "Video compressor is closed" }
        check(finalMetadata.width > 0 && finalMetadata.height > 0 && finalMetadata.duration > 0) { "Invalid encoded video" }
        val rotated = finalMetadata.rotation == 90 || finalMetadata.rotation == 270
        outputs[id] = output
        retained = true
        mapOf(
          "id" to id,
          "uri" to Uri.fromFile(output).toString(),
          "width" to if (rotated) finalMetadata.height else finalMetadata.width,
          "height" to if (rotated) finalMetadata.width else finalMetadata.height,
          "duration" to finalMetadata.duration,
          "fileSize" to size,
        )
      } finally {
        if (!retained) output.delete()
      }
    }
  }

  suspend fun release(id: String) = withContext(Dispatchers.Main.immediate) {
    // Only ids produced by this module can delete files; source paths are never accepted.
    outputs.remove(id)?.let { check(it.delete() || !it.exists()) { "Could not remove encoded video" } }
    Unit
  }

  fun close() {
    main.post {
      closed = true
      running.values.toList().forEach { it() }
      outputs.values.forEach { it.delete() }
      outputs.clear()
    }
  }
}
