#!/usr/bin/env bash
# Prove check-sidebar-refs.mjs can fail.
#
# A check that only ever passes is worth nothing, and this repository has
# produced several. Each case removes one thing the check claims to guarantee
# and asserts it is named with exit 1, then that the tree recovers.
#
# The mutation is done in Python, not sed: a sidebar anchor wraps its label in
# a `<span>`, so `>[^<]*</a>` matches nothing and every case "passed" while
# changing the page not at all.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

drop() {  # name, page, href-substring
  local name="$1" page="$2" needle="$3"
  cp "$page" "$tmp/page.bak"
  python3 - "$page" "$needle" <<'PY'
import re, sys
path, needle = sys.argv[1], sys.argv[2]
html = open(path, encoding='utf8').read()
out, n = re.subn(r'<a[^>]*href="[^"]*' + re.escape(needle) + r'[^"]*"[\s\S]*?</a>', '', html)
if n == 0:
    sys.exit(f'negative test could not find an anchor matching {needle}')
open(path, 'w', encoding='utf8').write(out)
PY
  local out code
  out=$(node scripts/check-sidebar-refs.mjs 2>&1); code=$?
  cp "$tmp/page.bak" "$page"
  if [ "$code" -eq 0 ]; then
    printf '  FAIL  %-32s check still passed\n' "$name"; return 1
  fi
  printf '  ok    %-32s exit 1: %s\n' "$name" \
    "$(printf '%s' "$out" | grep -m1 -E '^  ' | sed 's/^ *//' | cut -c1-58)"
}

fails=0
rs=_site/rs/concepts/index.html
py=_site/py/stable/concepts/index.html
[ -f "$py" ] || py=_site/py/concepts/index.html

drop 'our reference removed'   "$rs" '/reference/rs/'  || fails=1
drop 'ecosystem link removed'  "$rs" 'docs.rs'         || fails=1
drop 'upstream reference gone' "$py" '/api/'           || fails=1

if node scripts/check-sidebar-refs.mjs >/dev/null 2>&1; then
  printf '  ok    %-32s exit 0\n' 'restored'
else
  printf '  FAIL  %-32s did not recover\n' 'restored'; fails=1
fi
exit $fails
