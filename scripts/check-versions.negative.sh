#!/usr/bin/env bash
# Prove build-site.sh refuses a version slug it cannot honestly build.
#
# `$version` reaches the URL, the cache key and the version switcher, and no
# git command. Every build renders the checkout at HEAD, so a tag, a
# maintenance branch or a PR slug would publish today's tree at
# /py/v0.62.0/ as though it came from that source.
#
# The assertion is on the guard's message, not on the exit code. Both were
# tried; exit code is worthless here. `--versions latest` on its own exits 1
# because a tree with no /py/stable/ has dangling cross-port links — a real
# failure, unrelated to this guard, that made the control look like a pass for
# the wrong reason. A control that fails for its own reasons proves nothing.
#
# Honest slugs are checked with a timeout: the guard fires within a second, so
# if the message has not appeared by then it never will, and there is no need
# to sit through a four-minute build to learn it. The build those controls do
# start goes to a scratch directory.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

MESSAGE='cannot build'
failures=0

fired() {  # slug -> prints 1 if the guard spoke, 0 if not
  # Into a scratch tree, never _site: a control has to run a real build to
  # prove it gets past the guard, and writing that over the site the rest of
  # the suite is checking left later checks reading a half-built tree.
  LIBTMUX_DOCS_OUT_DIR="$tmp/site" \
    timeout 15 ./scripts/build-site.sh --versions "$1" --skip-refs --skip-pagefind 2>&1 |
    grep -c "$MESSAGE" || true
}

check() {  # slug, want (1 = must refuse, 0 = must proceed), why
  local slug="$1" want="$2" why="$3" got
  got=$(fired "$slug")
  if [ "$got" != "$want" ]; then
    if [ "$want" = 1 ]; then
      echo "FAIL $slug — built a slug it cannot honestly build ($why)"
    else
      echo "FAIL $slug — refused a slug it renders correctly ($why)"
    fi
    failures=$((failures + 1))
  else
    echo "ok   $(printf '%-10s' "$slug") $why"
  fi
}

# Every kind_for_version outcome that names a source other than HEAD.
check v0.62.0 1 'a release tag'
check v0.6.x  1 'a maintenance branch'
check pr-12   1 'a pull request'
check v1      1 'unrecognised, treated as a branch'

# The controls. Without them a guard that refused everything would pass above.
check latest  0 'trunk, which is what HEAD is'
check stable  0 'an alias, resolved at render time'

if [ "$failures" -gt 0 ]; then
  echo
  echo "build-site.sh mislabels $failures of the version slugs it accepts."
  exit 1
fi
echo
echo 'check-versions.negative: only latest and stable build; every other slug is refused'
