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

# Whichever version was built, mirroring check-sidebar-refs.mjs's pageFor().
#
# Naming a slug in advance is what broke this: `rs` was hard-coded to the
# unversioned path with no fallback, so once its prose moved under a version
# every case here died on a missing file rather than testing anything.
locale="${LIBTMUX_DOCS_LOCALE:-en}"

page_for() {
  local port="$1" root candidate
  # The locale tree first, then the bare form, mirroring check-sidebar-refs.mjs.
  for root in "_site/$locale/$port" "_site/$port"; do
    candidate="$root/concepts/index.html"
    if [ -f "$candidate" ]; then printf '%s' "$candidate"; return 0; fi
    for dir in "$root"/*/; do
      candidate="${dir}concepts/index.html"
      if [ -f "$candidate" ]; then printf '%s' "$candidate"; return 0; fi
    done
  done
  return 1
}

drop() {  # name, page, href-substring, expected-message
  local name="$1" page="$2" needle="$3" says="$4"
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
  # The message, not just the exit code. A build-layout change that made the
  # mutation a no-op would still exit non-zero for its own reasons, and this
  # would have read as a pass.
  if ! printf '%s' "$out" | grep -qF "$says"; then
    printf '  FAIL  %-32s exit 1 but never said: %s\n' "$name" "$says"; return 1
  fi
  printf '  ok    %-32s exit 1: %s\n' "$name" \
    "$(printf '%s' "$out" | grep -m1 -E '^  ' | sed 's/^ *//' | cut -c1-58)"
}

fails=0
rs=$(page_for rs) || { echo 'no rs shell page under _site — run ./scripts/build-site.sh' >&2; exit 1; }
py=$(page_for py) || { echo 'no py shell page under _site — run ./scripts/build-site.sh' >&2; exit 1; }

drop 'our reference removed'   "$rs" '/reference/rs/' 'rs: sidebar does not link /reference/rs/' || fails=1
drop 'ecosystem link removed'  "$rs" 'docs.rs'        'rs: sidebar does not link docs.rs' || fails=1
drop 'upstream reference gone' "$py" '/api/'          'py: sidebar does not link the upstream gp-sphinx reference' || fails=1

if node scripts/check-sidebar-refs.mjs >/dev/null 2>&1; then
  printf '  ok    %-32s exit 0\n' 'restored'
else
  printf '  FAIL  %-32s did not recover\n' 'restored'; fails=1
fi
exit $fails
