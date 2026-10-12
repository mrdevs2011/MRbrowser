#!/usr/bin/env bash
# MRBrowser installer (Linux / WebKit Classic UI)
set -euo pipefail
APP_NAME=MRBrowser
REPO="${MRBROWSER_REPO:-mrdevs2011/MRbrowser}"
INSTALL_DIR="${MRBROWSER_DIR:-$HOME/MR/Applictions}"
BIN_LINK="$HOME/.local/bin/mrbrowser"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_CACHE="$HOME/.cache/mr-apps-icons"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

echo "==> $APP_NAME o'rnatilmoqda ($OS / $ARCH)..."
mkdir -p "$INSTALL_DIR" "$HOME/.local/bin" "$DESKTOP_DIR" "$ICON_CACHE"

download(){
  if command -v curl >/dev/null; then
    curl -fsSL -o "$2" "$1"
  elif command -v wget >/dev/null; then
    wget -qO "$2" "$1"
  else
    echo "curl yoki wget kerak"; exit 1
  fi
}

API="https://api.github.com/repos/${REPO}/releases/latest"
ASSET_NAME="MRBrowser.AppImage"
TARGET="$INSTALL_DIR/MRBrowser.AppImage"

TMP="$(mktemp)"
echo "==> Eng so'nggi $ASSET_NAME yuklab olinmoqda..."
if download "$API" "$TMP" 2>/dev/null; then
  ASSET_URL="$(python3 -c "import json,sys; j=json.load(open(sys.argv[1])); print(next((a['browser_download_url'] for a in j.get('assets',[]) if a.get('name')==sys.argv[2]), ''))" "$TMP" "$ASSET_NAME" 2>/dev/null || true)"
  rm -f "$TMP"
  if [ -n "${ASSET_URL:-}" ]; then
    download "$ASSET_URL" "$TARGET"
  else
    download "https://github.com/${REPO}/releases/download/v2.3.0/MRBrowser.AppImage" "$TARGET"
  fi
else
  rm -f "$TMP" 2>/dev/null || true
  download "https://github.com/${REPO}/releases/download/v2.3.0/MRBrowser.AppImage" "$TARGET"
fi

chmod +x "$TARGET"
ln -sfn "$TARGET" "$BIN_LINK"

ICON="$ICON_CACHE/MRBrowser.png"
if [ -f assets/icon.png ]; then
  cp -f assets/icon.png "$ICON" 2>/dev/null || true
fi

cat > "$DESKTOP_DIR/mr-app-MRBrowser.desktop" << DESK
[Desktop Entry]
Type=Application
Name=MRBrowser
Comment=MR Browser (WebKit Classic)
Exec="$TARGET" %U
Terminal=false
Categories=Network;WebBrowser;
Icon=$ICON
StartupWMClass=MRBrowser
DESK

chmod +x "$DESKTOP_DIR/mr-app-MRBrowser.desktop" || true
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo "==> Muvaffaqiyatli o'rnatildi! Joylashuv: $TARGET"
echo "Ishga tushirish uchun: mrbrowser"
