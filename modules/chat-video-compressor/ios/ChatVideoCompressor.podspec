Pod::Spec.new do |s|
  s.name           = 'ChatVideoCompressor'
  s.version        = '1.0.0'
  s.summary        = 'Chat video compression before upload'
  s.description    = 'Re-encodes picked chat videos as 720p H.264 MP4 before upload.'
  s.license        = 'UNLICENSED'
  s.author         = 'WindNote'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['AVFoundation']

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
