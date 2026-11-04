#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ruby scripts/prepare-native-tests.rb
SIMULATOR_ID=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; devices=json.load(sys.stdin)["devices"]; print(next(d["udid"] for runtime,rows in devices.items() if "iOS" in runtime for d in rows if d["name"].startswith("iPhone")))')
xcodebuild -project ios/App/App.xcodeproj -scheme NativeStartup \
  -configuration Debug -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -derivedDataPath build -resultBundlePath build/NativeStartup.xcresult \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
xcrun simctl io "$SIMULATOR_ID" screenshot build/native-startup.png
