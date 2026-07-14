Pod::Spec.new do |s|
  s.name           = 'SyncerStorage'
  s.version        = '1.0.0'
  s.summary        = 'Syncer local file publication module'
  s.description    = 'Publishes received Syncer files into the application Documents directory.'
  s.license        = { :type => 'Proprietary', :text => 'Copyright WBBB. All rights reserved.' }
  s.author         = 'WBBB'
  s.homepage       = 'https://github.com/WBBB0730/Syncer'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/WBBB0730/Syncer.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'QuickLook'

  s.source_files = '**/*.{h,m,swift}'
  s.exclude_files = 'Tests/'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.test_spec 'Tests' do |test_spec|
    test_spec.dependency 'ExpoModulesTestCore'
    test_spec.source_files = 'Tests/**/*.swift'
  end
end
