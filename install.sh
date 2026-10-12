#!/usr/bin/env bash
# MRBrowser installer (Linux / macOS)
set -euo pipefail
APP_NAME=MRBrowser
REPO=${MRBROWSER_REPO:-mrdevs2011/mrbrowser}
INSTALL_DIR=${MRBROWSER_DIR:-$HOME/MR/Applictions}
BIN_LINK=$HOME/.local/bin/mrbrowser
DESKTOP_DIR=$HOME/.local/share/applications
ICON_CACHE=$HOME/.cache/mr-apps-icons
OS=$(uname -s | tr "[:upper:]" "[:lower:]")
ARCH=$(uname -m)
echo "==> $APP_NAME install ($OS / $ARCH)"
mkdir -p "$INSTALL_DIR" "$HOME/.local/bin" "$DESKTOP_DIR" "$ICON_CACHE"
download(){ if command -v curl >/dev/null; then curl -fsSL -o "$2" "$1"; elif command -v wget >/dev/null; then wget -qO "$2" "$1"; else echo need curl/wget; exit 1; fi; }
API=https://api.github.com/repos/${REPO}/releases/latest
if [ "$OS" = linux ]; then ASSET_NAME=MRBrowser.AppImage; TARGET=$INSTALL_DIR/MRBrowser.AppImage; elif [ "$OS" = darwin ]; then ASSET_NAME=MRBrowser-mac.zip; TARGET=$INSTALL_DIR/MRBrowser-mac.zip; else echo unsupported; exit 1; fi
TMP=$(mktemp); USE_SOURCE=1
if download "$API" "$TMP" 2>/dev/null; then
  ASSET_URL=$(python3 -c "import json,sys;j=json.load(open(sys.argv[1]));n=sys.argv[2];print(next((a.get(rowser_download_url\) or \ for a in (j.get(ssets\) or []) if a.get(
ame\)==n),\))" "$TMP" "$ASSET_NAME" 2>/dev/null || true)
  rm -f "$TMP"
  if [ -n "${ASSET_URL:-}" ]; then echo downloading $ASSET_NAME; download "$ASSET_URL" "$TARGET"; USE_SOURCE=0; fi
else rm -f "$TMP" 2>/dev/null || true; fi
if [ "$USE_SOURCE" = 1 ]; then
  WORK=${TMPDIR:-/tmp}/mrbrowser-install-$$; rm -rf "$WORK"
  git clone --depth 1 https://github.com/${REPO}.git "$WORK"
  cd "$WORK"
  if command -v npm >/dev/null; then npm install; if [ "$OS" = linux ]; then npm run dist || true; if [ -f dist/MRBrowser.AppImage ]; then cp -f dist/MRBrowser.AppImage "$INSTALL_DIR/MRBrowser.AppImage"; TARGET=$INSTALL_DIR/MRBrowser.AppImage; USE_SOURCE=0; fi; fi; fi
  if [ "$USE_SOURCE" = 1 ]; then printf "%s
" "#!/usr/bin/env bash" "cd $WORK && npm start" > "$INSTALL_DIR/mrbrowser-dev.sh"; chmod +x "$INSTALL_DIR/mrbrowser-dev.sh"; ln -sfn "$INSTALL_DIR/mrbrowser-dev.sh" "$BIN_LINK"; echo dev install ok; exit 0; fi
fi
if [ "$OS" = linux ]; then
  chmod +x "$TARGET"; rm -rf "$HOME/.cache/mrbrowser" 2>/dev/null || true
  ln -sfn "$TARGET" "$BIN_LINK"
  ICON=$ICON_CACHE/MRBrowser.png
  [ -f assets/icon.png ] && cp -f assets/icon.png "$ICON" 2>/dev/null || true
  cat > "$DESKTOP_DIR/mr-app-MRBrowser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=MRBrowser
Comment=MR Browser
Exec=env LD_PRELOAD=/usr/lib/libwayland-client.so.0 "$TARGET" %U
Terminal=false
Categories=Network;WebBrowser;
Icon=$ICON
StartupWMClass=MRBrowser
EOF
  chmod +x "$DESKTOP_DIR/mr-app-MRBrowser.desktop" || true
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  echo OK AppImage: $TARGET; echo Run: mrbrowser
else echo macOS: $TARGET; fi
