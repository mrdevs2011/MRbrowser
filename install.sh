#!/usr/bin/env bash
# MR Browser — Tezkor o‘rnatuvchi (AppImage)
set -euo pipefail

REPO="mrdevs2011/MRbrowser"
INSTALL_DIR="$HOME/.local/share/mrbrowser"
BIN_LINK="$HOME/.local/bin/mrbrowser"
DESKTOP_DIR="$HOME/.local/share/applications"
TARGET="$INSTALL_DIR/MRBrowser.AppImage"

echo "==> MR Browser o‘rnatilmoqda..."
mkdir -p "$INSTALL_DIR" "$HOME/.local/bin" "$DESKTOP_DIR"

# Oxirgi reliz AppImage URL manzilini olish
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/MRBrowser.AppImage"

echo "==> AppImage yuklab olinmoqda: $DOWNLOAD_URL"
if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar -o "$TARGET" "$DOWNLOAD_URL"
elif command -v wget >/dev/null 2>&1; then
    wget -q --show-progress -O "$TARGET" "$DOWNLOAD_URL"
else
    echo "Xato: curl yoki wget topilmadi!" >&2
    exit 1
fi

chmod +x "$TARGET"
ln -sfn "$TARGET" "$BIN_LINK"

# Desktop yorlig‘ini yaratish
cat > "$DESKTOP_DIR/mrbrowser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=MR Browser
Comment=Super tezkor WebKit brauzer
Exec=$TARGET %U
Terminal=false
Categories=Network;WebBrowser;
StartupWMClass=mrbrowser
EOF

chmod +x "$DESKTOP_DIR/mrbrowser.desktop" 2>/dev/null || true
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo "==> Muvaffaqiyatli o‘rnatildi!"
echo "Ishga tushirish uchun: mrbrowser"
