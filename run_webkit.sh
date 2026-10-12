#!/usr/bin/env bash
# MR Browser — Native WebKit6 / GTK4 Launcher

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/target/release/mrbrowser"

if [ -f "$BIN" ]; then
    exec "$BIN" "$@"
else
    # Agar binar hali yig'ilmagan bo'lsa
    cd "$DIR" && cargo run --release -- "$@"
fi
