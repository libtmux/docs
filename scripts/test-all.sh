#!/usr/bin/env bash
# Publication audit: source checks, complete assembly, output and browser audits.
# This has no development-loop time budget; use pnpm test for fresh sampled rendering.
#
# Usage: scripts/test-all.sh [--skip-build]
set -euo pipefail

cd "$(dirname "$0")/.."
out="$(node --input-type=module -e 'import { resolve } from "node:path"; console.log(resolve(process.env.LIBTMUX_DOCS_OUT_DIR || "_site"))')"
export LIBTMUX_DOCS_OUT_DIR="$out"
export LIBTMUX_DOCS_TEST_SITE="$out"
SERVE_URL="${LIBTMUX_DOCS_SERVE:-http://localhost:8080}"
# The served site, one locale segment below the origin. serve.sh serves the
# bucket root, so a page URL carries the prefix the assembly built under.
SERVE_SITE="$SERVE_URL/${LIBTMUX_DOCS_LOCALE:-en}"
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

# `publish-root.sh` is the one script here that can delete objects from a
# bucket, so it is worth a linter that reads shell. `-x` follows the sourced
# bookkeeping instead of reporting a caller's variables as unassigned, and the
# probe is `--version` rather than `command -v` because a version manager's
# shim resolves and then fails.
step 'shell scripts'
if shellcheck --version > /dev/null 2>&1; then
  shellcheck -x -S warning scripts/*.sh
else
  note_skip 'shellcheck (not installed)'
  echo 'shellcheck not installed; skipped'
fi

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

# site/public/_shell/shell.js is injected into rustdoc, Dokka, DocC and Sphinx
# output, so it has no bundler and cannot import ports.ts. Its copy of the port
# table is generated and compared here for the same reason the API models are:
# a hand-kept copy rots silently, and this one already had — its comment named
# a `referenceMode` field ports.ts no longer has.
# Prose inlines the code each port actually tests, read from that port's
# checkout. CI has none, so the resolved sources are committed and compared
# here — the same contract as the API models above. Without it the cache rots
# into showing code no port runs any more, which is worse than no example.
step 'example sources'
node scripts/gen-example-sources.mjs --check

step 'example sources (negative)'
node scripts/gen-example-sources.negative.mjs

step 'shell port table'
node scripts/gen-shell-ports.mjs --check

step 'shell port table (negative)'
node scripts/gen-shell-ports.negative.mjs

# /mcp/ and /mcp/tools/ count and compare the tools each port registers, read
# from that port's own registration site. Absent from this gate, the matrix
# went stale unnoticed: libtmux-java replaced ToolSpec.of with a capability
# registry and its 45 tools extracted as none. Skips when the sibling
# checkouts are absent, as the API models above do.
step 'mcp tool matrix'
node scripts/gen-mcp-tools.mjs --check

step 'source links'
node scripts/check-source-links.mjs

step 'unit tests'
LIBTMUX_DOCS_TEST_SOURCE_ONLY=1 pnpm run --recursive --if-present test

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
LIBTMUX_DOCS_TEST_SOURCE_ONLY=0 pnpm --filter @libtmux/site exec vitest run --reporter=verbose 2>&1 \
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
# The checks below read the site; `$out` is the bucket root, which also holds
# robots.txt above every locale. The site itself is one segment in.
site_out="$out/${LIBTMUX_DOCS_LOCALE:-en}"

step 'sidebar references'
node scripts/check-sidebar-refs.mjs "$site_out"

# A cross-reference that stops resolving still renders, as plain code, so no
# link breaks and nothing else fails. Only a floor catches it.
step 'sidebar references (negative)'
./scripts/check-sidebar-refs.negative.sh

step 'cross-reference resolution'
node scripts/check-xrefs.mjs "$site_out"

step 'cross-reference resolution (negative)'
node scripts/check-xrefs.negative.mjs

# A type name that resolves to nothing still renders, as plain text. Swift's
# conformances rendered mangled symbol ids that way through a green suite.
step 'type name resolution'
node scripts/check-type-links.mjs "$site_out"

step 'type name resolution (negative)'
node scripts/check-type-links.negative.mjs

# The edge function decides file-versus-page from an extension allowlist. A
# generator adding a file type breaks that URL class at the CDN, where no link
# check here can see it — every link in the tree still resolves.
# The reference tree carries no version and no locale, so a page there has no
# other page to point at. Nothing else asserts a canonical anywhere.
step 'reference canonicals'
node scripts/check-canonicals.mjs "$site_out"

step 'reference canonicals (negative)'
node scripts/check-canonicals.negative.mjs

# The function CloudFront actually runs is the copy in the infrastructure
# repository, because Terraform cannot read across repositories. The edit that
# would go unnoticed is exactly the one the check above guards — an extension
# allowlist changed here, correct here, and not deployed.
step 'edge function copy'
node scripts/check-edge-function-copy.mjs

step 'edge function copy (negative)'
node scripts/check-edge-function-copy.negative.mjs

step 'edge extensions'
node scripts/check-edge-extensions.mjs "$out"

step 'edge extensions (negative)'
node scripts/check-edge-extensions.negative.mjs

step 'api fidelity'
node scripts/check-api-fidelity.mjs "$site_out"

# The visual checks need the pages served, and style parity needs the gp-sphinx
# twin as well — which only a full assembly produces. Both run against a
# running server; `pnpm test:publication` reports that they were not run rather than
# implying they passed.
if curl -sf -o /dev/null "$SERVE_SITE/reference/py/libtmux-server/"; then
  # Type is checked here rather than with the static suites because half of
  # it is a rendering question: which faces a page opens with is answered by
  # laying the page out, not by reading its HTML.
  step 'fonts'
  (cd site && node scripts/check-fonts.mjs --url "$SERVE_SITE")

  # The mobile shell is behaviour, not pixels: which drawer is open, what has
  # focus, whether the toolbar is there at all at a given width. None of it
  # shows up in a screenshot of one viewport.
  step 'mobile navigation'
  (cd site && node scripts/check-mobile-nav.mjs "$SERVE_SITE")

  step 'table layout'
  (cd site && node scripts/check-tables.mjs "$SERVE_SITE")

  step 'visual regression'
  (cd site && node scripts/check-visual.mjs "$SERVE_SITE")

  if curl -sf -o /dev/null "$SERVE_SITE/py/stable/api/api/libtmux.server/"; then
    step 'native page navigation'
    (cd site && node scripts/check-native-shell.mjs "$SERVE_SITE")

    step 'style parity with gp-sphinx'
    (cd site && node scripts/check-style-parity.mjs "$SERVE_SITE")
  else
    printf '\nstyle parity skipped: no gp-sphinx page at %s — run scripts/build-site.sh\n' "$SERVE_URL"
    note_skip 'style parity'
    note_skip 'native page navigation'
    skip_reason="no gp-sphinx page at $SERVE_URL — run scripts/build-site.sh"
  fi
else
  printf '\nvisual checks skipped: nothing serving at %s\n' "$SERVE_URL"
  note_skip 'fonts'
  note_skip 'mobile navigation'
  note_skip 'table layout'
  note_skip 'visual regression'
  note_skip 'style parity'
  note_skip 'native page navigation'
  skip_reason="nothing serving at $SERVE_URL — run scripts/serve.sh"
fi

summarise_run "$skipped" "$skip_reason"
