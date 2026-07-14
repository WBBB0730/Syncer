Pod::Spec.new do |s|
  s.name           = 'SyncerAlarmKit'
  s.version        = '1.0.0'
  s.summary        = 'Syncer Find Device AlarmKit bridge'
  s.description    = 'Uses AlarmKit for Find Device feedback on supported Apple systems.'
  s.license        = { :type => 'Proprietary', :text => 'Copyright WBBB. All rights reserved.' }
  s.author         = 'WBBB'
  s.homepage       = 'https://github.com/WBBB0730/Syncer'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/WBBB0730/Syncer.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
