#!/bin/bash
# Unspark — bundle main executable.
# Launches the bundled Python which spawns a PyWebView window directly.
# No Terminal, no AppleScript droplet — this script IS the .app process.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
RSRC="$HERE/../Resources"
exec "$RSRC/python/bin/python3" "$RSRC/Scripts/app.py" "$@"
