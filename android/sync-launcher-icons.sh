#!/usr/bin/env bash
set -euo pipefail

# Reuse the approved iOS artwork; never redraw the brand for Android.
# Requires ImageMagick 6 (convert) or 7 (magick).
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
if command -v magick >/dev/null 2>&1; then
  image_tool=magick
else
  image_tool=convert
fi
source_icon=native-assets/ios/AppIcon.appiconset/AppIcon-ios-marketing-1024x1024@1x.png
resources=android/app/src/main/res

# Android 8+ uses the existing adaptive artwork with safe-area padding.
mkdir -p "$resources/drawable-nodpi"
cp native-assets/android/drawable-nodpi/ic_launcher_foreground.png "$resources/drawable-nodpi/"
cp native-assets/android/mipmap-anydpi-v26/ic_launcher*.xml "$resources/mipmap-anydpi-v26/"
cp native-assets/android/values/colors.xml "$resources/values/launcher_colors.xml"

for spec in mdpi:48:82 hdpi:72:123 xhdpi:96:164 xxhdpi:144:246 xxxhdpi:192:328; do
  IFS=: read -r density size maskable_size <<< "$spec"
  destination="$resources/mipmap-$density"
  "$image_tool" "$source_icon" -resize "${size}x${size}" -depth 8 -strip "$destination/ic_launcher.png"
  cp "native-assets/android/mipmap-$density/ic_launcher_round.png" "$destination/ic_launcher_round.png"
  "$image_tool" "$source_icon" -resize "${maskable_size}x${maskable_size}" -depth 8 -strip "$destination/ic_maskable.png"
done

# Play listing and TWA regeneration sources use the same dark artwork.
"$image_tool" "$source_icon" -resize 512x512 -depth 8 -strip android/store_icon.png
cp android/store_icon.png icons/play-icon-512.png
cp android/store_icon.png icons/play-maskable-512.png
