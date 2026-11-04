#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ruby scripts/prepare-native-tests.rb
SIMULATOR_ID=${TAMOON_SIMULATOR_ID:-$(xcrun simctl list devices available -j | python3 -c 'import json,sys; devices=json.load(sys.stdin)["devices"]; print(next(d["udid"] for runtime,rows in devices.items() if "iOS" in runtime for d in rows if d["name"].startswith("iPhone")))')}
# Keychain rejects unsigned simulator apps. Supply simulator-only ad hoc
# entitlements; distribution entitlements remain unchanged in the source.
mkdir -p build
python3 - <<'PY'
import pathlib, plistlib
entitlements = plistlib.loads(pathlib.Path('ios/App/App/App.entitlements').read_bytes())
entitlements.update({
    'application-identifier': '4T892ZTN46.br.app.tamoon',
    'com.apple.developer.team-identifier': '4T892ZTN46',
    'keychain-access-groups': ['4T892ZTN46.br.app.tamoon'],
    'get-task-allow': True,
})
pathlib.Path('build/NativeSimulator.entitlements').write_bytes(plistlib.dumps(entitlements))
PY
xcodebuild -project ios/App/App.xcodeproj -scheme NativeStartup \
  -configuration Debug -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -derivedDataPath build -resultBundlePath build/NativeStartup.xcresult \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- \
  CODE_SIGN_STYLE=Manual CODE_SIGN_ENTITLEMENTS="$PWD/build/NativeSimulator.entitlements" test
xcrun simctl io "$SIMULATOR_ID" screenshot build/native-startup.png
