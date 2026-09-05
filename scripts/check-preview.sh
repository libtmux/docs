#!/usr/bin/env bash
#
# A PR preview must contain itself.
#
# deploy-shell.yml publishes a pull request's build under /pr-<n>/. Every
# root-relative URL the shell emits — the header's own links, the port and
# version switchers, ports.ts's URL builders, the version manifest fetch —
# then points at production instead of the preview, silently, with the
# preview's header still on screen. That is not a broken link a crawler
# catches; it is a working link to the wrong site.
#
# This builds the shell exactly the way that workflow does and fails if any
# absolute URL in the output leaves the prefix.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prefix="${1:-pr-42}"
out="$(mktemp -d "${TMPDIR:-/tmp}/libtmux-preview.XXXXXX")"
trap 'rm -rf "$out"' EXIT

(
  cd "$repo_root/site"
  LIBTMUX_DOCS_VERSION="$prefix" \
    LIBTMUX_DOCS_VERSION_KIND=pr \
    LIBTMUX_DOCS_IS_DEFAULT=false \
    LIBTMUX_DOCS_BASE="/$prefix/" \
    LIBTMUX_DOCS_ROOT="/$prefix/" \
    LIBTMUX_DOCS_SITE=https://libtmux.org \
    LIBTMUX_DOCS_SKIP_PAGEFIND=true \
    pnpm exec astro build --outDir "$out"
) >/dev/null 2>&1 || { echo "check-preview: the preview build itself failed" >&2; exit 1; }

# Single-leading-slash only: '//host' is protocol-relative and legitimately
# off-site, and a full URL is off-site by construction.
escapes="$(rg -o '(?:href|src)="(/[^"/][^"]*)"' -r '$1' --no-filename -g '*.html' "$out" \
  | rg -v "^/$prefix/" | sort | uniq -c | sort -rn || true)"

pages="$(fd -e html . "$out" | wc -l | tr -d ' ')"
if [ -n "$escapes" ]; then
  echo "check-preview: absolute URLs escaping /$prefix/ across $pages pages:" >&2
  echo "$escapes" >&2
  exit 1
fi
echo "check-preview: $pages pages, every absolute URL stays inside /$prefix/"
