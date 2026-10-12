# MR Browser 🚀

> **WebKit6 & GTK4** dvigatelida ishlaydigan, yonma-yon gorizontal tasma bilan boshqariluvchi, to'liq maxfiy va yashin tezligidagi brauzer.

---

## ✨ Asosiy afzalliklari

- **⚡ Nativ WebKit Dvigateli:** Chromium va og'ir runtimelardan xoli, minimal xotira (RAM) sarfi.
- **📜 Gorizontal Strip (Yonma-yon tablar):** Tablar cheksiz gorizontal lentada joylashadi, ravon animatsiya bilan siljiydi.
- **🛡️ 100% Maxfiy:** Hech qanday hisob/login talab qilinmaydi, kuzatuvchilarsiz toza internet.
- **🎨 Zamonaviy UI:** Klassik ko'p funksiyali boshqaruv paneli, doimiy Omnibox, qulay Sidebar va tezkor qidiruv.
- **🪶 Atigi ~400 KB:** Binar fayl hajmi mikroskopik darajada yengil.

---

## 📥 O‘rnatish

Terminalda bir buyruq bilan o‘rnatish:

```bash
curl -fsSL https://raw.githubusercontent.com/mrdevs2011/MRbrowser/main/install.sh | bash
```

O‘rnatilgach, ishga tushirish:

```bash
mrbrowser
```

---

## ⌨️ Asosiy klaviatura yorliqlari

| Yorliq | Vazifasi |
|---|---|
| <kbd>Ctrl</kbd> + <kbd>T</kbd> | Yangi tab ochish |
| <kbd>Ctrl</kbd> + <kbd>W</kbd> | Joriy tabni yopish |
| <kbd>Ctrl</kbd> + <kbd>G</kbd> / <kbd>L</kbd> | Manzil yoki qidiruvga o‘tish |
| <kbd>Ctrl</kbd> + <kbd>F</kbd> | Tab kengligini o‘zgartirish (Yarim / To‘liq) |
| <kbd>Ctrl</kbd> + <kbd>O</kbd> | Barcha tablarni ko‘rish (Overview zoom-out) |
| <kbd>Ctrl</kbd> + <kbd>B</kbd> | Yon panelni (Sidebar) yashirish / ko‘rsatish |
| <kbd>Ctrl</kbd> + <kbd>H</kbd> / <kbd>L</kbd> | Chap / O‘ng tabga fokus berish |

---

## 🛠️ Manba kodidan yig‘ish (Developers)

```bash
# WebKit6 va GTK4 kutubxonalari kerak:
# Ubuntu/Debian: sudo apt install libwebkitgtk-6.0-dev libgtk-4-dev
# Arch Linux:   sudo pacman -S webkitgtk-6.0 gtk4

cargo build --release
./target/release/mrbrowser
```
