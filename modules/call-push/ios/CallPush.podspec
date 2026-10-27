require 'json'

# 构建期开关（plugins/with-call-push.js 写进 ios/Podfile.properties.json）：
# notification = 将来的中国区包，CallKit / PushKit 一律不编译、不链接。
podfile_properties =
  begin
    JSON.parse(File.read(File.join(Pod::Config.instance.installation_root, 'Podfile.properties.json')))
  rescue StandardError
    {}
  end
notification_mode = podfile_properties['callPush.iosMode'] == 'notification'

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
  s.frameworks = notification_mode ? ['UserNotifications'] : ['PushKit', 'CallKit', 'AVFAudio']

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => notification_mode ? '$(inherited) CALL_PUSH_NO_CALLKIT' : '$(inherited)'
  }
end
