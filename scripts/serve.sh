#!/usr/bin/env bash
# Serve the assembled site at http://localhost:8080/en/ .
#
# The site is built with trailing-slash URLs and directory indexes, which is
# what the CloudFront function reproduces in production, so a plain static
# server with directory-index support matches deployed behaviour closely
# enough to trust what you see here.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
site="$repo_root/_site"
port="${1:-8080}"
locale="${LIBTMUX_DOCS_LOCALE:-en}"

if [ -f "$site/$locale/index.html" ]; then
  start_path="/$locale/"
elif [ -f "$site/index.html" ]; then
  start_path="/"
else
  echo "No assembled site at $site — run scripts/build-site.sh first." >&2
  exit 1
fi

echo "libtmux.org  ->  http://localhost:$port$start_path"
exec python3 -m http.server "$port" --directory "$site" --bind 127.0.0.1
