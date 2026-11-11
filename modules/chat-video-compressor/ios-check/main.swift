// macOS harness for the iOS transcoder (AVFoundation is shared between the two platforms).
// Build: swiftc -swift-version 5 ../ios/VideoCompressionProfile.swift ../ios/ChatVideoTranscoder.swift main.swift -o /tmp/vc-check
// Run:   /tmp/vc-check <video>...   — prints one JSON line per input; null means "keep the original".
import AVFoundation

let transcoder = ChatVideoTranscoder()
for path in CommandLine.arguments.dropFirst() {
  let name = (path as NSString).lastPathComponent
  do {
    let start = Date()
    if let video = try await transcoder.compress(URL(fileURLWithPath: path).absoluteString) {
      let seconds = String(format: "%.2f", Date().timeIntervalSince(start))
      print("\(name): {\"uri\":\"\(video.uri)\",\"width\":\(video.width),\"height\":\(video.height),\"duration\":\(video.duration),\"fileSize\":\(video.fileSize),\"seconds\":\(seconds)}")
    } else {
      print("\(name): null")
    }
  } catch {
    print("\(name): error \(error)")
  }
}
