#!/usr/bin/env bash
# MR Browser — Aqlli va Super tezkor o‘rnatuvchi (~400 KB)
set -euo pipefail

REPO="mrdevs2011/MRbrowser"
INSTALL_DIR="$HOME/.local/bin"
TARGET="$INSTALL_DIR/mrbrowser"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "==> MR Browser o‘rnatilmoqda..."
mkdir -p "$INSTALL_DIR" "$DESKTOP_DIR"

# 1. Tizimda WebKit6 / GTK4 bor-yo'qligini tekshirish
has_webkit6() {
    if ldconfig -p 2>/dev/null | grep -q "libwebkitgtk-6.0.so.4"; then
        return 0
    elif [ -f "/usr/lib/libwebkitgtk-6.0.so.4" ] || [ -f "/usr/lib64/libwebkitgtk-6.0.so.4" ] || [ -f "/usr/lib/x86_64-linux-gnu/libwebkitgtk-6.0.so.4" ]; then
        return 0
    fi
    return 1
}

if has_webkit6; then
    echo "✓ Tizimda WebKit6 topildi! Ortiqcha paketlar yuklanmaydi."
else
    echo "⚠️ Tizimda WebKit6 topilmadi. O‘rnatish tavsiya etiladi:"
    if command -v apt-get >/dev/null 2>&1; then
        echo "   Buyruq: sudo apt install libwebkitgtk-6.0-4 libgtk-4-1"
    elif command -v pacman >/dev/null 2>&1; then
        echo "   Buyruq: sudo pacman -S webkitgtk-6.0 gtk4"
    elif command -v dnf >/dev/null 2>&1; then
        echo "   Buyruq: sudo dnf install webkitgtk6.0 gtk4"
    fi
fi

# 2. Atigi ~400 KB lik tezkor binar faylni yuklab olish
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/mrbrowser"
echo "==> MR Browser binar fayli yuklab olinmoqda (atigi ~400 KB)..."

rm -f "$TARGET"

if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar -o "$TARGET" "$DOWNLOAD_URL"
elif command -v wget >/dev/null 2>&1; then
    wget -q --show-progress -O "$TARGET" "$DOWNLOAD_URL"
else
    echo "Xato: curl yoki wget topilmadi!" >&2
    exit 1
fi

chmod +x "$TARGET"

# 3. Eski yorliqlarni tozalash va yangi .desktop qo'shish
rm -f "$DESKTOP_DIR/mr-app-MRBrowser.desktop" 2>/dev/null || true
rm -rf "$HOME/.cache/mrbrowser" 2>/dev/null || true

cat > "$DESKTOP_DIR/mrbrowser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=MR Browser
Comment=Super tezkor WebKit6 brauzer (~400 KB)
Exec=$TARGET %U
Terminal=false
Categories=Network;WebBrowser;
StartupWMClass=uz.mr.browser
EOF

chmod +x "$DESKTOP_DIR/mrbrowser.desktop" 2>/dev/null || true
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo "==> Muvaffaqiyatli o‘rnatildi! Hajmi: $(du -h "$TARGET" | cut -f1)"
echo "Ishga tushirish uchun: mrbrowser"
