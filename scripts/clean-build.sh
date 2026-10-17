#!/usr/bin/env bash
set -euo pipefail

dry_run=0
cache=0
for option in "$@"; do
  case "$option" in
    --dry-run) dry_run=1 ;;
    --cache) cache=1 ;;
    -h|--help)
      printf '%s\n' 'Usage: scripts/clean-build.sh [--dry-run] [--cache]' \
        'Remove generated site output and staging in this checkout.' \
        '--cache also removes the reusable .build-cache/ directory.' \
        'Stop development and preview servers before cleaning.'
      exit 0 ;;
    *) printf 'clean-build: unknown option: %s\n' "$option" >&2; exit 2 ;;
  esac
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
exec 9>>"$repo_root/.build.lock"
if ! flock --nonblock 9; then
  printf 'clean-build: an assembly holds .build.lock; wait for it to finish.\n' >&2
  exit 1
fi

targets=(_site site/dist site/.astro site/src/content/api site/src/content/docs/_staged)
if [ "$cache" -eq 1 ]; then targets+=(.build-cache); fi
shopt -s nullglob
for staging in "$repo_root"/_site.*/; do targets+=("${staging#"$repo_root/"}"); done
selected=()
for target in "${targets[@]}"; do
  path="$repo_root/${target%/}"
  if [ -e "$path" ] || [ -L "$path" ]; then
    parent="$(cd -- "$(dirname "$path")" && pwd -P)"
    case "$parent/" in
      "$repo_root/"*) selected+=("$path") ;;
      *) printf 'clean-build: target parent leaves the checkout: %s; repair the symlink and retry.\n' "$target" >&2; exit 1 ;;
    esac
  fi
done
for path in "${selected[@]}"; do
  printf 'Remove %s\n' "${path#"$repo_root/"}"
  if [ "$dry_run" -eq 0 ]; then rm -rf -- "$path"; fi
done
