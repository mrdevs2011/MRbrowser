#!/usr/bin/env bash
# MR Browser — Build self-contained AppImage (WebKitGTK Classic)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/target/appimage-build"
APPDIR="$WORK/MRBrowser.AppDir"
ARCH=x86_64

echo "==> Preparing clean AppDir for MRBrowser (Classic WebKit)"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/mrbrowser" "$APPDIR/usr/share/applications" "$APPDIR/usr/share/icons/hicolor/256x256/apps"

cp "$ROOT/mrbrowser_webkit.py" "$APPDIR/usr/share/mrbrowser/"
cp "$ROOT/run_webkit.sh" "$APPDIR/usr/bin/mrbrowser"
chmod +x "$APPDIR/usr/bin/mrbrowser"

cp -r "$ROOT/src" "$APPDIR/usr/share/mrbrowser/"
cp -r "$ROOT/assets" "$APPDIR/usr/share/mrbrowser/" 2>/dev/null || true
[ -f "$ROOT/ui.html" ] && cp "$ROOT/ui.html" "$APPDIR/usr/share/mrbrowser/" || true
[ -f "$ROOT/internal.html" ] && cp "$ROOT/internal.html" "$APPDIR/usr/share/mrbrowser/" || true

# AppRun
cat > "$APPDIR/AppRun" << 'RUN'
#!/usr/bin/env bash
HERE="$(dirname "$(readlink -f "${0}")")"
export PYTHONUNBUFFERED=1
export WEBKIT_DISABLE_COMPOSITING_MODE=0
export WEBKIT_FORCE_COMPOSITING_MODE=1
export GDK_RENDERING=gl
export WEBKIT_GST_HOLEPUNCH=1
cd "$HERE/usr/share/mrbrowser"
exec python3 "$HERE/usr/share/mrbrowser/mrbrowser_webkit.py" "$@"
RUN
chmod +x "$APPDIR/AppRun"

# Desktop entry
cat > "$APPDIR/mrbrowser.desktop" << 'DESK'
[Desktop Entry]
Type=Application
Name=MRBrowser
Comment=MR Browser (Classic WebKit)
Exec=mrbrowser %U
Icon=mrbrowser
Terminal=false
Categories=Network;WebBrowser;
StartupWMClass=mrbrowser
DESK

# Icon
if [ -f "$ROOT/assets/icon.png" ]; then
  cp "$ROOT/assets/icon.png" "$APPDIR/mrbrowser.png"
  cp "$ROOT/assets/icon.png" "$APPDIR/.DirIcon"
  cp "$ROOT/assets/icon.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/mrbrowser.png"
fi

echo "==> Packaging with appimagetool"
TOOL="/home/muhamad/.cache/appimagetool/squashfs-root/AppRun"
mkdir -p "$ROOT/dist"
ARCH=$ARCH "$TOOL" "$APPDIR" "$ROOT/dist/MRBrowser.AppImage"
ls -lh "$ROOT/dist/MRBrowser.AppImage"
echo "==> AppImage created successfully!"
