#!/usr/bin/env bash
set -euo pipefail

# Convert a recorded .webm to broadcast-friendly .mp4 (H.264, yuv420p).
# Usage: ./scripts/convert.sh input.webm [output.mp4]

in="${1:?input.webm required}"
out="${2:-${in%.webm}.mp4}"

ffmpeg -y -i "$in" \
  -c:v libx264 \
  -pix_fmt yuv420p \
  -crf 18 \
  -preset slow \
  -movflags +faststart \
  "$out"

echo "Wrote $out"
