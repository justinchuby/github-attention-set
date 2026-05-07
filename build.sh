#!/bin/bash
# Build zip for Chrome Web Store upload
set -e

NAME="github-attention-set"
VERSION=$(grep '"version"' manifest.json | sed 's/.*: "//;s/".*//')
OUT="${NAME}-v${VERSION}.zip"

rm -f "$OUT"
zip -r "$OUT" . \
  -x ".git/*" \
  -x "node_modules/*" \
  -x "tests/*" \
  -x "*.test.*" \
  -x "package*.json" \
  -x "vitest*" \
  -x "screenshot*" \
  -x "build.sh" \
  -x "scripts/*" \
  -x ".gitignore" \
  -x "*.md" \

echo "Built: $OUT ($(du -h "$OUT" | cut -f1))"
