import Foundation

/// Mirrors the Android `videoCompressionProfile`. Sizes are in the track's natural (pre-rotation)
/// orientation because the writer keeps the source transform instead of rotating pixels.
struct VideoCompressionProfile: Equatable {
  static let maxLongEdge = 1280
  static let maxBitrate = 1_500_000
  static let minFileSize: Int64 = 2 * 1024 * 1024

  let width: Int
  let height: Int
  let bitrate: Int

  static func make(width: Int, height: Int, bitrate: Int, fileSize: Int64) -> VideoCompressionProfile? {
    // Tiny clips and already economical clips are not worth re-encoding.
    if fileSize < minFileSize { return nil }
    let longEdge = max(width, height)
    if longEdge <= maxLongEdge && (1...maxBitrate).contains(bitrate) { return nil }
    let scale = min(1.0, Double(maxLongEdge) / Double(longEdge))
    return VideoCompressionProfile(
      width: max(2, Int(floor(Double(width) * scale / 2)) * 2),
      height: max(2, Int(floor(Double(height) * scale / 2)) * 2),
      bitrate: bitrate > 0 ? min(bitrate, maxBitrate) : maxBitrate
    )
  }
}
