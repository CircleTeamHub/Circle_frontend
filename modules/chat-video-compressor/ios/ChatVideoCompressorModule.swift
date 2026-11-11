import ExpoModulesCore

public final class ChatVideoCompressorModule: Module {
  private let transcoder = ChatVideoTranscoder()

  public func definition() -> ModuleDefinition {
    Name("ChatVideoCompressor")

    AsyncFunction("compress") { (uri: String) async throws -> [String: Any]? in
      guard let video = try await self.transcoder.compress(uri) else { return nil }
      return [
        "id": video.id,
        "uri": video.uri,
        "width": video.width,
        "height": video.height,
        "duration": video.duration,
        "fileSize": video.fileSize,
      ]
    }

    AsyncFunction("release") { (id: String) async throws in
      try await self.transcoder.release(id)
    }

    OnDestroy {
      let transcoder = self.transcoder
      Task { await transcoder.close() }
    }
  }
}
