Pod::Spec.new do |s|
  s.name           = 'CallPush'
  s.version        = '1.0.0'
  s.summary        = 'Push-based incoming calls (PushKit + CallKit)'
  s.description    = 'Rings incoming calls from VoIP pushes through CallKit, including when the app is not running.'
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
  s.frameworks = 'PushKit', 'CallKit', 'AVFAudio'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
