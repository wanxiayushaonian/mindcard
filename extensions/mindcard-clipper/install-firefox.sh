#!/bin/bash
# MindCard Clipper — Firefox installation helper
# manifest.json is already the Firefox version (no swap needed).
#
# Usage: ./install-firefox.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "MindCard Clipper — Firefox"
echo ""
echo "To install (temporary, for development):"
echo "  1. Open about:debugging#/runtime/this-firefox"
echo "  2. Click 'Load Temporary Add-on'"
echo "  3. Select any file inside: $SCRIPT_DIR"
echo ""
echo "To package for distribution:"
echo "  zip -r mindcard-clipper-firefox.zip . --exclude '*.sh' --exclude 'manifest.chrome.json'"
echo ""
echo "For Chrome, use manifest.chrome.json:"
echo "  cp manifest.chrome.json manifest.json"
echo "  (then load unpacked from chrome://extensions/)"
