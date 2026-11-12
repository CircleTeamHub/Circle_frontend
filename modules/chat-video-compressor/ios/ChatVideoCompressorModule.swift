import AVFoundation
import ExpoModulesCore

/// iOS side of the chat video compressor. Mirrors the Android module's contract:
/// `compress(uri)` resolves an owned MP4 (id, uri, width, height, duration ms, fileSize)
/// or null when re-encoding would not help; `release(id)` deletes an owned output.
///
/// It uses the same 1280x720 H.264 export preset the system photo picker applied before
/// the chat switched to an in-app gallery, so uploads keep the size and quality users had.
public class ChatVideoCompressorModule: Module {
  private let outputs = ChatVideoOutputStore()

  public func definition() -> ModuleDefinition {
    Name("ChatVideoCompressor")

    AsyncFunction("compress") { (uri: String) async throws -> [String: Any]? in
      try await ChatVideoTranscoder.compress(uri: uri, outputs: self.outputs)
    }

    AsyncFunction("release") { (id: String) in
      self.outputs.release(id)
    }

    OnDestroy {
      self.outputs.releaseAll()
    }
  }
}

final class ChatVideoInvalidUriException: Exception {
  override var reason: String { "Video URI must be a local file" }
}

final class ChatVideoNoTrackException: Exception {
  override var reason: String { "Input must contain a video track" }
}

final class ChatVideoExportException: Exception {
  override var reason: String { "Video export failed" }
}

/// Owns exported files and in-flight sessions so module teardown can cancel and clean up.
final class ChatVideoOutputStore {
  private let lock = NSLock()
  private var files: [String: URL] = [:]
  private var sessions: [String: AVAssetExportSession] = [:]

  func begin(_ id: String, file: URL, session: AVAssetExportSession) {
    lock.lock()
    defer { lock.unlock() }
    files[id] = file
    sessions[id] = session
  }

  func finish(_ id: String) {
    lock.lock()
    defer { lock.unlock() }
    sessions[id] = nil
  }

  func release(_ id: String) {
    lock.lock()
    let file = files.removeValue(forKey: id)
    let session = sessions.removeValue(forKey: id)
    lock.unlock()
    session?.cancelExport()
    if let file { try? FileManager.default.removeItem(at: file) }
  }

  func releaseAll() {
    lock.lock()
    let ids = Array(files.keys)
    lock.unlock()
    ids.forEach(release)
  }
}

enum ChatVideoTranscoder {
  private static let minimumBytes: Int64 = 2 * 1024 * 1024
  private static let maximumLongEdge: CGFloat = 1280

  static func compress(uri: String, outputs: ChatVideoOutputStore) async throws -> [String: Any]? {
    guard let source = URL(string: uri), source.isFileURL else {
      throw ChatVideoInvalidUriException()
    }
    let sourceBytes = fileSize(at: source)
    // Tiny clips are not worth re-encoding.
    if sourceBytes > 0 && sourceBytes < minimumBytes { return nil }

    let asset = AVURLAsset(url: source)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw ChatVideoNoTrackException()
    }
    // One property per load: the tuple-returning multi-property overloads may not exist on iOS 15.
    let naturalSize = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let formats = try await track.load(.formatDescriptions)
    let display = naturalSize.applying(transform)
    let longEdge = max(abs(display.width), abs(display.height))
    let isH264 = formats.contains {
      CMFormatDescriptionGetMediaSubType($0) == kCMVideoCodecType_H264
    }
    // Already what the export would produce (e.g. picked through the system picker,
    // which exports 720p H.264 itself): a second pass would only lose quality.
    if isH264 && longEdge <= maximumLongEdge { return nil }

    guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else {
      throw ChatVideoExportException()
    }
    let id = UUID().uuidString
    let output = try outputDirectory().appendingPathComponent("\(id).mp4")
    session.outputURL = output
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true
    outputs.begin(id, file: output, session: session)

    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      session.exportAsynchronously { continuation.resume() }
    }
    outputs.finish(id)

    guard session.status == .completed else {
      outputs.release(id)
      throw ChatVideoExportException()
    }
    let outputBytes = fileSize(at: output)
    // Only hand back output that actually saves bytes; the caller keeps the original otherwise.
    if outputBytes <= 0 || (sourceBytes > 0 && outputBytes >= sourceBytes) {
      outputs.release(id)
      return nil
    }

    let exportedDisplay: CGSize
    let duration: CMTime
    do {
      let exported = AVURLAsset(url: output)
      guard let exportedTrack = try await exported.loadTracks(withMediaType: .video).first else {
        throw ChatVideoNoTrackException()
      }
      let exportedSize = try await exportedTrack.load(.naturalSize)
      let exportedTransform = try await exportedTrack.load(.preferredTransform)
      exportedDisplay = exportedSize.applying(exportedTransform)
      duration = try await exported.load(.duration)
    } catch {
      // JS never learns this id, so nothing else would delete the file.
      outputs.release(id)
      throw error
    }

    return [
      "id": id,
      "uri": output.absoluteString,
      "width": Int(abs(exportedDisplay.width).rounded()),
      "height": Int(abs(exportedDisplay.height).rounded()),
      "duration": Int((CMTimeGetSeconds(duration) * 1000).rounded()),
      "fileSize": outputBytes,
    ]
  }

  private static func outputDirectory() throws -> URL {
    let caches = try FileManager.default.url(
      for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let directory = caches.appendingPathComponent("chat-video-compressor", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private static func fileSize(at url: URL) -> Int64 {
    let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
    return (attributes?[.size] as? NSNumber)?.int64Value ?? 0
  }
}
