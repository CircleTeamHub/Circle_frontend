Pod::Spec.new do |s|
  s.name           = 'ChatVideoCompressor'
  s.version        = '1.0.0'
  s.summary        = 'Re-encodes chat videos to 1280px / 1.5 Mbps H.264 before upload'
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'WindNote'
  s.homepage       = 'https://github.com/CircleTeamHub/Circle_frontend'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.swift'
end
