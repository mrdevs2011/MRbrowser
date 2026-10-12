// Electron binarini wrapper bilan almashtiramiz:
// 1) Wayland bayroqlari ishga tushirishdan oldin berilishi kerak.
// 2) AppImage ichidagi (FUSE/squashfs) fayllar sekin o'qiladi, shuning uchun birinchi ishga tushishda
//    ~/.cache/mrbrowser ga ochib olamiz, keyingi ishga tushishlar shu nusxadan tez ishlaydi.
const fs = require('fs');
const path = require('path');
exports.default = async (ctx) => {
  const exe = path.join(ctx.appOutDir, 'mrbrowser');
  fs.renameSync(exe, exe + '.bin');
  fs.writeFileSync(exe, `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
KEY="$(stat -c '%s-%Y' "$HERE/mrbrowser.bin")-$(stat -c '%s-%Y' "$HERE/resources/app.asar" 2>/dev/null || echo na)"
BASE="\${XDG_CACHE_HOME:-$HOME/.cache}/mrbrowser"
CACHE="$BASE/$KEY"
RUN="$HERE"
if [ -x "$CACHE/mrbrowser.bin" ]; then
  RUN="$CACHE"
else
  TMP="$BASE/.tmp.$$"
  if mkdir -p "$TMP" && cp -a "$HERE/." "$TMP/"; then
    if [ -x "$CACHE/mrbrowser.bin" ]; then rm -rf "$TMP"; else mv -T "$TMP" "$CACHE" 2>/dev/null || rm -rf "$TMP"; fi
    [ -x "$CACHE/mrbrowser.bin" ] && RUN="$CACHE"
    for d in "$BASE"/*; do [ -d "$d" ] && [ "$d" != "$CACHE" ] && rm -rf "$d"; done
  else
    rm -rf "$TMP"
  fi
fi
if [ -n "$WAYLAND_DISPLAY" ]; then
  exec "$RUN/mrbrowser.bin" --ozone-platform=wayland --disable-features=Vulkan "$@"
else
  exec "$RUN/mrbrowser.bin" "$@"
fi
`);
  fs.chmodSync(exe, 0o755);
};
