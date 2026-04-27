#!/bin/bash
# Build Unspark.app bundle from sources.
# Produces a fully self-contained .app (~1 GB) — bundled Python, LaMa weights,
# all dependencies. No system Python or Homebrew required at runtime.
#
# Usage: ./build.sh [output_dir]
set -e

OUT="${1:-./dist}"
APP="$OUT/Unspark.app"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo "  Unspark — bundle builder"
echo "============================================"
echo "Output: $APP"
echo ""

# 1. Fresh bundle skeleton
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# 2. Embed sources
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
cp "$HERE/launcher.sh" "$APP/Contents/MacOS/Unspark"
chmod +x "$APP/Contents/MacOS/Unspark"
cp -r "$HERE/Scripts" "$APP/Contents/Resources/Scripts"
cp -r "$HERE/web" "$APP/Contents/Resources/web"
cp "$HERE/requirements.txt" "$APP/Contents/Resources/Scripts/requirements.txt"

# 3. Download relocatable Python (python-build-standalone, ~50 MB tarball)
PY_VER="3.11.15"
PY_REL="20260414"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PY_REL}/cpython-${PY_VER}+${PY_REL}-aarch64-apple-darwin-install_only.tar.gz"

echo "Downloading Python $PY_VER (~20 MB compressed)..."
TMP_TAR="$(mktemp -t unspark-py.XXXXXX.tar.gz)"
curl -fL -o "$TMP_TAR" "$PY_URL"
tar -xzf "$TMP_TAR" -C "$APP/Contents/Resources/"
rm "$TMP_TAR"

# 4. Install Python deps into bundled Python
PY="$APP/Contents/Resources/python/bin/python3"
echo ""
echo "Installing Python deps (torch + LaMa, ~1-2 GB on disk)..."
"$PY" -m pip install --upgrade pip wheel
"$PY" -m pip install -r "$APP/Contents/Resources/Scripts/requirements.txt"

# 5. Pre-download LaMa weights (196 MB, GitHub release)
echo ""
echo "Pre-downloading LaMa weights..."
mkdir -p "$APP/Contents/Resources/torch_cache/hub/checkpoints"
TORCH_HOME="$APP/Contents/Resources/torch_cache" "$PY" -c \
  "from simple_lama_inpainting import SimpleLama; SimpleLama(); print('weights ok')"

# 6. Render app icon from web/assets/spark.svg via macOS native qlmanage
echo ""
echo "Building icon..."
ICONSET="$(mktemp -d -t unspark.iconset.XXXXXX).iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
RENDER_DIR="$(mktemp -d -t unspark.render.XXXXXX)"
qlmanage -t -s 1024 -o "$RENDER_DIR" "$HERE/web/assets/spark.svg" >/dev/null 2>&1
SRC_PNG="$RENDER_DIR/spark.svg.png"
"$PY" - <<EOF
from PIL import Image
src = Image.open("$SRC_PNG").convert("RGBA")
sizes = [(16,"16x16"),(32,"16x16@2x"),(32,"32x32"),(64,"32x32@2x"),
         (128,"128x128"),(256,"128x128@2x"),(256,"256x256"),
         (512,"256x256@2x"),(512,"512x512"),(1024,"512x512@2x")]
for size, name in sizes:
    src.resize((size, size), Image.LANCZOS).save(f"$ICONSET/icon_{name}.png")
EOF
iconutil -c icns -o "$APP/Contents/Resources/Unspark.icns" "$ICONSET"
rm -rf "$ICONSET" "$RENDER_DIR"

# 7. Ad-hoc sign so Gatekeeper accepts a locally-built bundle
echo ""
echo "Ad-hoc signing..."
codesign --force --deep --sign - "$APP" 2>&1 | tail -3

echo ""
echo "============================================"
echo "  Built: $APP"
echo "  Size:  $(du -sh "$APP" | cut -f1)"
echo "============================================"
echo ""
echo "Test:  open \"$APP\""
echo "Pack:  hdiutil create -volname Unspark -srcfolder <stage> -format UDZO Unspark.dmg"
