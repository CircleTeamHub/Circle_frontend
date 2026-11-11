import AVFoundation

enum ChatVideoCompressorError: Error {
  case noVideoTrack
  case unsupported
  case encodingFailed
  case invalidOutput
  case closed
}

struct CompressedVideo: Sendable {
  let id: String
  let uri: String
  let width: Int
  let height: Int
  /// Milliseconds, like the picker asset the JS pipeline already consumes.
  let duration: Int
  let fileSize: Int64
}

actor ChatVideoTranscoder {
  // tmp/ is purged by the system, so a crash mid-export cannot leak files for good.
  private let directory = FileManager.default.temporaryDirectory
    .appendingPathComponent("chat-video-compression", isDirectory: true)
  private var outputs: [String: URL] = [:]
  private var closed = false

  func compress(_ source: String) async throws -> CompressedVideo? {
    // Never let this local optimization turn a media URL into another network download.
    guard let url = URL(string: source), url.isFileURL else { return nil }
    let inputSize = Self.fileSize(url)
    guard inputSize > 0 else { return nil }

    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw ChatVideoCompressorError.noVideoTrack
    }
    let (naturalSize, transform, dataRate, characteristics) = try await track.load(
      .naturalSize, .preferredTransform, .estimatedDataRate, .mediaCharacteristics)
    guard naturalSize.width > 0, naturalSize.height > 0 else { throw ChatVideoCompressorError.noVideoTrack }
    // The picker already exports SDR H.264; an 8-bit re-encode of HDR would wash colours out.
    if characteristics.contains(.containsHDRVideo) { return nil }
    guard let profile = VideoCompressionProfile.make(
      width: Int(naturalSize.width.rounded()),
      height: Int(naturalSize.height.rounded()),
      bitrate: Int(dataRate),
      fileSize: inputSize
    ) else { return nil }
    let audioTracks = try await asset.loadTracks(withMediaType: .audio)
    guard !closed else { throw ChatVideoCompressorError.closed }

    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let id = UUID().uuidString
    let output = directory.appendingPathComponent("\(id).mp4")
    var retained = false
    defer { if !retained { try? FileManager.default.removeItem(at: output) } }

    let export = try VideoExport(
      asset: asset, videoTrack: track, audioTracks: audioTracks,
      transform: transform, profile: profile, output: output)
    let frames = try await export.run()
    // close() may have run while the export was in flight; its outputs must not survive it.
    guard !closed else { throw ChatVideoCompressorError.closed }
    let size = Self.fileSize(output)
    if frames <= 0 || size <= 0 || size >= inputSize { return nil }

    // Read display orientation and duration from the actual MP4, not the picker source.
    let encoded = AVURLAsset(url: output)
    let duration = try await encoded.load(.duration)
    guard let encodedTrack = try await encoded.loadTracks(withMediaType: .video).first else {
      throw ChatVideoCompressorError.invalidOutput
    }
    let (encodedSize, encodedTransform) = try await encodedTrack.load(.naturalSize, .preferredTransform)
    let display = CGRect(origin: .zero, size: encodedSize).applying(encodedTransform).size
    let durationMs = Int((duration.seconds * 1000).rounded())
    guard !closed else { throw ChatVideoCompressorError.closed }
    guard display.width > 0, display.height > 0, durationMs > 0 else {
      throw ChatVideoCompressorError.invalidOutput
    }

    outputs[id] = output
    retained = true
    return CompressedVideo(
      id: id,
      uri: output.absoluteString,
      width: Int(display.width.rounded()),
      height: Int(display.height.rounded()),
      duration: durationMs,
      fileSize: size
    )
  }

  func release(_ id: String) throws {
    // Only ids produced by this module can delete files; source paths are never accepted.
    guard let url = outputs.removeValue(forKey: id) else { return }
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  func close() {
    closed = true
    for url in outputs.values { try? FileManager.default.removeItem(at: url) }
    outputs.removeAll()
  }

  private static func fileSize(_ url: URL) -> Int64 {
    Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
  }
}

/// One reader → writer pass: H.264 at the profile's size and bitrate, audio re-encoded to AAC.
private final class VideoExport: @unchecked Sendable {
  private let reader: AVAssetReader
  private let writer: AVAssetWriter
  private let pumps: [Pump]

  init(
    asset: AVAsset,
    videoTrack: AVAssetTrack,
    audioTracks: [AVAssetTrack],
    transform: CGAffineTransform,
    profile: VideoCompressionProfile,
    output: URL
  ) throws {
    reader = try AVAssetReader(asset: asset)
    writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    // moov first: recipients can start playing before the whole file has downloaded.
    writer.shouldOptimizeForNetworkUse = true

    let videoOutput = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
    ])
    videoOutput.alwaysCopiesSampleData = false
    let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: profile.width,
      AVVideoHeightKey: profile.height,
      AVVideoScalingModeKey: AVVideoScalingModeResizeAspectFill,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: profile.bitrate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      ],
    ])
    videoInput.expectsMediaDataInRealTime = false
    videoInput.transform = transform
    var pumps = [Pump(output: videoOutput, input: videoInput, label: "chat-video-compressor.video")]

    if !audioTracks.isEmpty {
      let audioOutput = AVAssetReaderAudioMixOutput(
        audioTracks: audioTracks, audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
      audioOutput.alwaysCopiesSampleData = false
      var stereo = AudioChannelLayout()
      stereo.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo
      let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 2,
        AVChannelLayoutKey: Data(bytes: &stereo, count: MemoryLayout<AudioChannelLayout>.size),
        AVEncoderBitRateKey: 128_000,
      ])
      audioInput.expectsMediaDataInRealTime = false
      pumps.append(Pump(output: audioOutput, input: audioInput, label: "chat-video-compressor.audio"))
    }

    for pump in pumps {
      guard reader.canAdd(pump.output), writer.canAdd(pump.input) else {
        throw ChatVideoCompressorError.unsupported
      }
      reader.add(pump.output)
      writer.add(pump.input)
    }
    self.pumps = pumps
  }

  /// Resolves with the number of encoded video frames.
  func run() async throws -> Int {
    try await withCheckedThrowingContinuation { continuation in
      guard writer.startWriting() else {
        continuation.resume(throwing: ChatVideoCompressorError.encodingFailed)
        return
      }
      guard reader.startReading() else {
        writer.cancelWriting()
        continuation.resume(throwing: ChatVideoCompressorError.encodingFailed)
        return
      }
      writer.startSession(atSourceTime: .zero)

      let group = DispatchGroup()
      for pump in pumps {
        group.enter()
        pump.start { group.leave() }
      }
      group.notify(queue: pumps[0].queue) { [self] in
        // A failed read or append leaves a truncated file; never hand that out.
        guard reader.status == .completed, writer.status == .writing else {
          if writer.status == .writing { writer.cancelWriting() }
          continuation.resume(throwing: ChatVideoCompressorError.encodingFailed)
          return
        }
        let frames = pumps[0].samples
        writer.finishWriting { [self] in
          if writer.status == .completed {
            continuation.resume(returning: frames)
          } else {
            continuation.resume(throwing: ChatVideoCompressorError.encodingFailed)
          }
        }
      }
    }
  }
}

/// Moves samples from one reader output to one writer input on its own serial queue.
private final class Pump: @unchecked Sendable {
  let output: AVAssetReaderOutput
  let input: AVAssetWriterInput
  let queue: DispatchQueue
  /// Only touched on `queue`; read after the dispatch group has completed.
  private(set) var samples = 0
  private var finished = false

  init(output: AVAssetReaderOutput, input: AVAssetWriterInput, label: String) {
    self.output = output
    self.input = input
    queue = DispatchQueue(label: label)
  }

  /// Appends until the reader runs dry or the writer refuses a sample; `done` runs exactly once.
  func start(_ done: @escaping @Sendable () -> Void) {
    input.requestMediaDataWhenReady(on: queue) { [self] in
      guard !finished else { return }
      while input.isReadyForMoreMediaData {
        guard let sample = output.copyNextSampleBuffer(), input.append(sample) else {
          finished = true
          input.markAsFinished()
          done()
          return
        }
        samples += 1
      }
    }
  }
}
