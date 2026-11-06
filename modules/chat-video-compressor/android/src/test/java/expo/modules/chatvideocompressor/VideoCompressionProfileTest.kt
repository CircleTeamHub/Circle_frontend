package expo.modules.chatvideocompressor

import org.junit.Assert.*
import org.junit.Test

class VideoCompressionProfileTest {
  private val large = 10_000_000L

  @Test fun landscapeIsStandardDefinitionWithBoundedBitrate() {
    assertEquals(VideoCompressionProfile(1280, 720, 1_500_000), videoCompressionProfile(1920, 1080, 0, 8_000_000, large))
  }

  @Test fun portraitAndRotationKeepTheirDisplayAspect() {
    assertEquals(VideoCompressionProfile(720, 1280, 1_500_000), videoCompressionProfile(1080, 1920, 0, 8_000_000, large))
    assertEquals(VideoCompressionProfile(720, 1280, 1_500_000), videoCompressionProfile(1920, 1080, 90, 8_000_000, large))
  }

  @Test fun smallerVideosAreNotUpscaled() {
    assertEquals(VideoCompressionProfile(640, 360, 1_500_000), videoCompressionProfile(640, 360, 0, 4_000_000, large))
  }

  @Test fun resizingDoesNotIncreaseAnAlreadyLowBitrate() {
    assertEquals(VideoCompressionProfile(1280, 720, 500_000), videoCompressionProfile(1920, 1080, 0, 500_000, large))
  }

  @Test fun smallFilesAndEconomicalVideosAreSkipped() {
    assertNull(videoCompressionProfile(1920, 1080, 0, 8_000_000, 500_000))
    assertNull(videoCompressionProfile(1280, 720, 0, 1_000_000, large))
  }

  @Test fun dimensionsAreEvenAndUnknownBitratesHaveABoundedTarget() {
    val profile = videoCompressionProfile(1921, 1081, 0, 0, large)!!
    assertTrue(profile.width <= 1280 && profile.height <= 1280)
    assertEquals(0, profile.width % 2)
    assertEquals(0, profile.height % 2)
    assertEquals(1_500_000, profile.bitrate)
  }

  @Test(expected = IllegalArgumentException::class) fun audioOnlyInputIsNotAcceptedAsVideo() {
    videoCompressionProfile(0, 0, 0, 128_000, large)
  }
}
