#!/usr/bin/env bash
# Everything that can say the docs are wrong, in one command.
#
# Ordered cheapest-first so a failure arrives as early as it can: unit tests
# in under a second, lint and type-check in tens of seconds, then a real build
# — because several classes of defect here are invisible to all three.
#
# The build is not optional and not a formality. A page whose every link
# points at a fragment that does not exist type-checks, lints and builds
# clean; so does a reference that sends Go readers to Python's manual. Only
# rendering the site and reading the output catches those, which is what the
# dangling-reference ceiling and scripts/check-links.mjs do here.
#
# Usage: scripts/test-all.sh [--skip-build]
set -euo pipefail

cd "$(dirname "$0")/.."
SERVE_URL="${LIBTMUX_DOCS_SERVE:-http://localhost:8080}"
skip_build=false
[[ "${1:-}" == "--skip-build" ]] && skip_build=true

# shellcheck source=scripts/skip-summary.sh
. "$(dirname "$0")/skip-summary.sh"
skipped=""
skip_reason=""
note_skip() { skipped="${skipped:+$skipped, }$1"; }

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step 'cached inventories'
# The inventories are committed, so this only reports their absence — but a
# build without them silently produces fewer links rather than failing, which
# is exactly the kind of quiet degradation worth a line of output.
node scripts/fetch-inventories.mjs --check
node scripts/build-inventories.mjs --check

# Source-level, so it needs no assembly and runs in a quarter second. It
# shares `decideMention` with the linker, so it cannot disagree with the build
# about what should have been a link.
step 'api links in prose'
node scripts/check-api-links.mjs

step 'mention index'
node scripts/gen-mentions.mjs --check

# The curated reference sidebar, against the model it curates: a symbol no
# bucket claims, a bucket no port fills, a symbol two buckets claim, and an
# exemption that has started matching again.
step 'reference sidebar curation'
node scripts/check-nav.mjs

# And the proof that those four can fail. Five checks in this repository could
# not, so a check now ships with the input that breaks it.
step 'reference sidebar curation (negative)'
node scripts/check-nav.negative.mjs

# The palette is gp-sphinx's and lives in tokens. A hard-coded grey is two
# greys that have to be kept in step by hand, and they were not.
step 'palette'
node scripts/check-palette.mjs

step 'palette (negative)'
node scripts/check-palette.negative.mjs

# The run summary has to say what it did not run. Four checks skip whenever
# nothing is serving, which is always in CI.
step 'run summary (negative)'
./scripts/check-summary.negative.sh

# A version slug names a source. This script only ever renders HEAD, so a slug
# naming anything else would publish today's tree as though it were a release.
step 'version slugs (negative)'
./scripts/check-versions.negative.sh

# The one class of link nothing else covers: `check-links.mjs` follows
# internal links, and a source link is a GitHub blob URL. Skips per port when
# the sibling checkout is absent rather than failing a fresh clone.
# The extracted models are committed so CI can build with no sibling
# checkouts. Committed generated data rots silently unless something compares
# it against its source, and nothing did.
step 'api model freshness'
node scripts/gen-api-model.mjs --check

step 'source links'
node scripts/check-source-links.mjs

step 'unit tests'
pnpm run --recursive --if-present test

step 'lint'
pnpm run lint

step 'type-check'
pnpm run type-check

if [[ "$skip_build" == true ]]; then
  printf '\nskipped the build; link and reference checks did not run\n'
  exit 0
fi

# The assembly, not one shell build.
#
# This used to run a single `astro build` into a scratch directory, which
# produces the root site and nothing else. Eleven of the output suites assert
# on what the *assembly* produces — `sitemap-index.xml`, each port's shell,
# every version the manifest advertises — so they failed, reporting a scratch
# directory's absences as defects. A command whose failures are its own
# artifacts is worse than no command: it trains you to read red as noise.
#
# The script already knew this and said so twelve lines down, where the style
# parity step notes it needs "a full assembly" and quietly reads a tree
# something else had built. Now one thing builds it.
#
# `build-site.sh` is content-addressed, so an unchanged tree reassembles in
# seconds and a changed one rebuilds only what moved. It writes `_site`, which
# is what `scripts/serve.sh` publishes — so what is checked here is the tree a
# reader gets, not a near-copy of it.
step 'build'
./scripts/build-site.sh
out="$(pwd)/_site"

# Named explicitly rather than left to the default. It is the same directory,
# and saying so is what stops the next person reintroducing a scratch build
# without noticing which suites depend on the assembly.
# Named, not just counted.
#
# A skipped `describe` reports as a pass, so "134 passed" and "109 passed, 25
# skipped" both read as green in a summary. The suites here skip on purpose
# when their inputs are absent — a fresh clone has no sibling checkouts — so
# skipping is not a failure, but it is a check that did not run and the reader
# should be told which.
step 'output tests'
LIBTMUX_DOCS_TEST_SITE="$out" pnpm --filter @libtmux/site exec vitest run --reporter=verbose 2>&1 \
  | tee /tmp/libtmux-output-tests.log \
  | grep -vE '^\s+[✓·]' || true
if grep -qE '[0-9]+ skipped' /tmp/libtmux-output-tests.log; then
  printf '\nskipped suites (a skip is a check that did not run):\n'
  grep -E '^\s*[↓-]|skipped' /tmp/libtmux-output-tests.log | head -20
fi
grep -qE 'Test Files.*failed' /tmp/libtmux-output-tests.log && exit 1

# No link step here. `build-site.sh` above already ran the authoritative one —
# `check-links.mjs "$out" --all` plus a `--vendored` exclusion per port and
# version — and fails the build when a link this repo generates is broken, so
# `set -e` carries it. Running the bare command again checked only
# `class="api-mention"` links: 4,060 against the assembly's 374,478, printed
# immediately below a line reporting the larger number. A weaker check that
# looks like the strong one is worse than no second check.
# What a port's sidebar offers is not a link-checking question: every link
# here resolved before this check existed, because the missing ones were
# simply never emitted.
step 'sidebar references'
node scripts/check-sidebar-refs.mjs "$out"

# A cross-reference that stops resolving still renders, as plain code, so no
# link breaks and nothing else fails. Only a floor catches it.
step 'sidebar references (negative)'
./scripts/check-sidebar-refs.negative.sh

step 'cross-reference resolution'
node scripts/check-xrefs.mjs "$out"

step 'cross-reference resolution (negative)'
node scripts/check-xrefs.negative.mjs

# A type name that resolves to nothing still renders, as plain text. Swift's
# conformances rendered mangled symbol ids that way through a green suite.
step 'type name resolution'
node scripts/check-type-links.mjs "$out"

step 'type name resolution (negative)'
node scripts/check-type-links.negative.mjs

# The edge function decides file-versus-page from an extension allowlist. A
# generator adding a file type breaks that URL class at the CDN, where no link
# check here can see it — every link in the tree still resolves.
# The reference tree carries no version and no locale, so a page there has no
# other page to point at. Nothing else asserts a canonical anywhere.
step 'reference canonicals'
node scripts/check-canonicals.mjs "$out"

step 'reference canonicals (negative)'
node scripts/check-canonicals.negative.mjs

step 'edge extensions'
node scripts/check-edge-extensions.mjs "$out"

step 'edge extensions (negative)'
node scripts/check-edge-extensions.negative.mjs

step 'api fidelity'
node scripts/check-api-fidelity.mjs "$out"

# The visual checks need the pages served, and style parity needs the gp-sphinx
# twin as well — which only a full assembly produces. Both run against a
# running server; `pnpm test` reports that they were not run rather than
# implying they passed.
if curl -sf -o /dev/null "$SERVE_URL/reference/py/libtmux-server/"; then
  # Type is checked here rather than with the static suites because half of
  # it is a rendering question: which faces a page opens with is answered by
  # laying the page out, not by reading its HTML.
  step 'fonts'
  (cd site && node scripts/check-fonts.mjs --url "$SERVE_URL")

  # The mobile shell is behaviour, not pixels: which drawer is open, what has
  # focus, whether the toolbar is there at all at a given width. None of it
  # shows up in a screenshot of one viewport.
  step 'mobile navigation'
  (cd site && node scripts/check-mobile-nav.mjs "$SERVE_URL")

  step 'visual regression'
  (cd site && node scripts/check-visual.mjs "$SERVE_URL")

  if curl -sf -o /dev/null "$SERVE_URL/py/stable/api/api/libtmux.server/"; then
    step 'style parity with gp-sphinx'
    (cd site && node scripts/check-style-parity.mjs "$SERVE_URL")
  else
    printf '\nstyle parity skipped: no gp-sphinx page at %s — run scripts/build-site.sh\n' "$SERVE_URL"
    note_skip 'style parity'
    skip_reason="no gp-sphinx page at $SERVE_URL — run scripts/build-site.sh"
  fi
else
  printf '\nvisual checks skipped: nothing serving at %s\n' "$SERVE_URL"
  note_skip 'fonts'
  note_skip 'mobile navigation'
  note_skip 'visual regression'
  note_skip 'style parity'
  skip_reason="nothing serving at $SERVE_URL — run scripts/serve.sh"
fi

summarise_run "$skipped" "$skip_reason"
