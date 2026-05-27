#!/bin/bash
# Build Firefox extension package
# Usage: ./install-firefox.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cp "$SCRIPT_DIR/manifest.json" "$SCRIPT_DIR/manifest.chrome.json"
cp "$SCRIPT_DIR/manifest.firefox.json" "$SCRIPT_DIR/manifest.json"

echo "Manifest switched to Firefox version."
echo ""
echo "To install in Firefox:"
echo "  1. Open about:debugging#/runtime/this-firefox"
echo "  2. Click 'Load Temporary Add-on'"
echo "  3. Select manifest.json from: $SCRIPT_DIR"
echo ""
echo "To switch back to Chrome manifest: mv manifest.chrome.json manifest.json"
