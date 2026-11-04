"""Verify the Release archive that will be signed/uploaded to Apple's internal beta."""
import json
import pathlib
import plistlib
import re
import subprocess
import sys

archive = pathlib.Path(sys.argv[1])
expected_build = sys.argv[2]
if not re.fullmatch(r"[1-9][0-9]{0,3}(?:\.[0-9]{1,2}){0,2}", expected_build):
    raise SystemExit("Invalid build number")
root = pathlib.Path(__file__).resolve().parents[2]
release = json.loads((root / "version.json").read_text())
apps = list((archive / "Products/Applications").glob("*.app"))
assert len(apps) == 1, "Expected exactly one application"
app = apps[0]
with (app / "Info.plist").open("rb") as stream:
    info = plistlib.load(stream)
assert info["CFBundleIdentifier"] == "br.app.tamoon"
assert info["CFBundleShortVersionString"] == f"1.0.{release['build']}"
assert info["CFBundleVersion"] == expected_build
assert info["CFBundleSupportedPlatforms"] == ["iPhoneOS"]
assert info["UIDeviceFamily"] == [1]
assert info["ITSAppUsesNonExemptEncryption"] is False
binary = app / info["CFBundleExecutable"]
assert subprocess.check_output(["lipo", "-archs", str(binary)], text=True).strip() == "arm64"
assert (app / "PrivacyInfo.xcprivacy").is_file()
assert (app / "Assets.car").is_file()
for name in ["index.html", "native.js", "auth-access.js", "account-deletion.js", "marketplace/index.html"]:
    assert (app / "public" / name).is_file(), name
flags = (app / "public/auth-config.js").read_text()
assert "appleEnabled: true" in flags and "linkingEnabled: true" in flags
for pattern in ["*.p8", "*.p12", "*.sql"]:
    assert not list((app / "public").rglob(pattern)), "Server/signing material in app assets"
assert not (app / "public/supabase").exists()
print(f"Release archive verified: br.app.tamoon / {info['CFBundleShortVersionString']} ({expected_build}) / arm64")
