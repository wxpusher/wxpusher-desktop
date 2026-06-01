#!/bin/bash

APP_DIR="/opt/WxPusher消息推送平台"
APP_BIN="$APP_DIR/wxpusher-desktop"
USR_BIN="/usr/bin/wxpusher-desktop"
SANDBOX="$APP_DIR/chrome-sandbox"

if type update-alternatives 2>/dev/null >&1; then
  # Remove previous link if it doesn't use update-alternatives.
  if [ -L "$USR_BIN" ] && [ -e "$USR_BIN" ] && [ "$(readlink "$USR_BIN")" != "/etc/alternatives/wxpusher-desktop" ]; then
    rm -f "$USR_BIN"
  fi
  update-alternatives --install "$USR_BIN" "wxpusher-desktop" "$APP_BIN" 100 || ln -sf "$APP_BIN" "$USR_BIN"
else
  ln -sf "$APP_BIN" "$USR_BIN"
fi

# Keep Electron's Linux SUID sandbox usable on Ubuntu releases where AppArmor
# restricts unprivileged user namespaces even though `unshare --user true` works.
#
# electron-builder 25 sets this to 0755 when user namespaces appear available,
# but Electron can still require the SUID helper on affected Ubuntu systems.
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" || true
  chmod 4755 "$SANDBOX" || true
fi

if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi
