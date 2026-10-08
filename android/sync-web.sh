#!/bin/sh
# Copies the web app (parent folder) into the APK's assets. Run before building if you changed the web files.
set -e
cd "$(dirname "$0")"
DEST=app/src/main/assets/www
rm -rf "$DEST" && mkdir -p "$DEST"
for f in ../*.html ../*.js ../*.webmanifest; do cp "$f" "$DEST/"; done
cp -r ../icons "$DEST/icons"
echo "Web files copied to $DEST"
