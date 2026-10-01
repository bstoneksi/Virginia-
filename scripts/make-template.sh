#!/usr/bin/env bash
#
# Build the shareable TEMPLATE zip for teammates:
#   - every tracked file at HEAD (no node_modules, no data/, no .env, no local config)
#   - assistant.config.json replaced by the generic assistant.config.example.json
#   - the first instance's click-through decision pages removed (its scope/spec docs stay as reference)
# Output: dist-template/<assistant-name>-template.zip
#
# Usage (Git Bash, from anywhere):  bash scripts/make-template.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

[[ -f assistant.config.example.json ]] || { echo "assistant.config.example.json is missing" >&2; exit 1; }
git rev-parse --verify HEAD >/dev/null 2>&1 || { echo "commit your work first: the template is built from HEAD" >&2; exit 1; }
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "note: uncommitted changes are NOT included (template is built from HEAD)" >&2
fi

NAME=$(node -e 'const c=require("./assistant.config.example.json"); process.stdout.write(String(c.assistant?.name||"assistant").toLowerCase().replace(/[^a-z0-9]+/g,"-"))')
OUT="dist-template"
STAGE="$OUT/stage"
ZIP="$OUT/${NAME}-template.zip"

rm -rf "$OUT"
mkdir -p "$STAGE"
git archive --format=tar HEAD | tar -x -C "$STAGE"

cp assistant.config.example.json "$STAGE/assistant.config.json"
rm -f "$STAGE/assistant.config.local.json"
rm -f "$STAGE"/docs/example-instance/decisions-round-*.html
rm -rf "$STAGE/dist-template"

# Create the zip with whatever archiver the machine has (Windows ships bsdtar; PowerShell has Compress-Archive).
if [[ -x "/c/Windows/System32/tar.exe" ]]; then
  ( cd "$STAGE" && "/c/Windows/System32/tar.exe" -a -c -f "../$(basename "$ZIP")" . )
elif command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command "Compress-Archive -Path '$(cygpath -w "$STAGE")\\*' -DestinationPath '$(cygpath -w "$ZIP")' -Force"
elif command -v zip >/dev/null 2>&1; then
  ( cd "$STAGE" && zip -qr "../$(basename "$ZIP")" . )
else
  echo "no zip tool found (need bsdtar, PowerShell or zip)" >&2; exit 1
fi

rm -rf "$STAGE"
echo "template written: $ZIP ($(du -h "$ZIP" | cut -f1))"
echo "share it with: ONBOARDING.md (inside the zip) explains the first steps."
