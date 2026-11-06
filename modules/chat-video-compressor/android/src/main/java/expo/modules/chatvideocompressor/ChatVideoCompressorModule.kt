package expo.modules.chatvideocompressor

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ChatVideoCompressorModule : Module() {
  private val transcoder = lazy {
    ChatVideoTranscoder(appContext.reactContext ?: throw Exceptions.ReactContextLost())
  }

  override fun definition() = ModuleDefinition {
    Name("ChatVideoCompressor")

    AsyncFunction("compress") Coroutine { uri: String ->
      transcoder.value.compress(uri)
    }

    AsyncFunction("release") Coroutine { id: String ->
      transcoder.value.release(id)
    }

    OnDestroy {
      if (transcoder.isInitialized()) transcoder.value.close()
    }
  }
}
