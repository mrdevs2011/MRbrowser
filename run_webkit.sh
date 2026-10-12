#!/usr/bin/env bash
# MR Browser WebKit ishga tushirish skripti

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export WEBKIT_FORCE_SANDBOX=0
python3 "$DIR/mrbrowser_webkit.py" "$@"
