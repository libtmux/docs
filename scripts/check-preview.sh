#!/usr/bin/env bash
# Audit the assembled artifact before publishing a PR preview.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:?usage: check-preview.sh <bucket-output> <pr-prefix>}"
prefix="${2:?usage: check-preview.sh <bucket-output> <pr-prefix>}"
preview="$out/$prefix"

if [[ ! "$prefix" =~ ^pr-[0-9]+$ ]] || [ ! -d "$preview" ]; then
  echo "check-preview: missing preview directory or invalid PR prefix" >&2
  exit 1
fi
pages="$(rg --files -g '*.html' "$preview" | wc -l | tr -d ' ')"

escapes="$(rg -o '(?:href|src)="(/[^"/][^"]*)"' -r '$1' --no-filename -g '*.html' "$preview" \
  | rg -v "^/$prefix/" | sort | uniq -c | sort -rn || true)"
if [ -n "$escapes" ]; then
  echo "check-preview: absolute URLs escaping /$prefix/ across $pages pages:" >&2
  echo "$escapes" >&2
  exit 1
fi
node "$repo_root/scripts/check-links.mjs" "$out" --all
echo "check-preview: $pages pages, internal links resolve within /$prefix/"
