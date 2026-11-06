package expo.modules.chatvideocompressor

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

internal data class VideoCompressionProfile(val width: Int, val height: Int, val bitrate: Int)

internal fun videoCompressionProfile(
  width: Int,
  height: Int,
  rotation: Int,
  bitrate: Int,
  fileSize: Long,
): VideoCompressionProfile? {
  require(width > 0 && height > 0) { "Input must contain a video track" }
  // Tiny clips and already economical standard-definition clips are not worth re-encoding.
  if (fileSize < 2 * 1024 * 1024) return null
  val displayWidth = if (rotation == 90 || rotation == 270) height else width
  val displayHeight = if (rotation == 90 || rotation == 270) width else height
  val longEdge = max(displayWidth, displayHeight)
  if (longEdge <= 1280 && bitrate in 1..1_500_000) return null
  val scale = min(1.0, 1280.0 / longEdge)
  return VideoCompressionProfile(
    width = max(2, floor(displayWidth * scale / 2).toInt() * 2),
    height = max(2, floor(displayHeight * scale / 2).toInt() * 2),
    bitrate = if (bitrate > 0) min(bitrate, 1_500_000) else 1_500_000,
  )
}
