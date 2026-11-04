# Add a hosted XCTest target only in the CI checkout, never to the distributed app.
gem 'xcodeproj', '1.27.0'
require 'xcodeproj'
mobile = File.expand_path('..', __dir__)
project_path = File.join(mobile, 'ios/App/App.xcodeproj')
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |target| target.name == 'App' }
raise 'App target missing' unless app
tests = project.new_target(:unit_test_bundle, 'NativeStartupTests', :ios, '15.0')
tests.add_dependency(app)
file = project.main_group.new_file('../../tests/NativeStartupTests.swift')
tests.source_build_phase.add_file_reference(file)
fixture = project.main_group.new_file('../../tests/home-fixture.js')
tests.resources_build_phase.add_file_reference(fixture)
tests.build_configurations.each do |config|
  config.build_settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'br.app.tamoon.NativeStartupTests'
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  config.build_settings['SWIFT_VERSION'] = '5.0'
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1'
  config.build_settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/App.app/App'
  config.build_settings['BUNDLE_LOADER'] = '$(TEST_HOST)'
  config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
  config.build_settings['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks']
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(app, tests, launch_target: true)
scheme.save_as(project_path, 'NativeStartup')
puts 'Hosted native startup test target ready.'
