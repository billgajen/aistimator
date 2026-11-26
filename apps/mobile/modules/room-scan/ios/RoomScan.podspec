Pod::Spec.new do |s|
  s.name           = 'RoomScan'
  s.version        = '0.1.0'
  s.summary        = 'LiDAR room scanning (Apple RoomPlan) for the Qolumns business app (T-138)'
  s.author         = 'Qolumns'
  s.homepage       = 'https://qolumns.com'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # Weak: the app still launches on iOS < 16 / devices without RoomPlan
  s.weak_frameworks = 'RoomPlan'
  s.source_files = '**/*.swift'
end
