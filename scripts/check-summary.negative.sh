#!/usr/bin/env bash
# Prove the run summary cannot say "all checks passed" when it did not run them.
#
# The four server-dependent checks skip whenever nothing is serving, which is
# always in CI. That is fine. What was not fine is that the run still ended
# "all checks passed" — the one line a reader carries away, and untrue of a run
# that skipped the four checks most likely to catch a rendering regression.
#
# Testing this by running scripts/test-all.sh twice would cost two full builds
# to assert one line, so the summary is its own sourceable function and this
# drives it directly.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

. scripts/skip-summary.sh

failures=0
ok()   { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s — %s\n' "$1" "$2"; failures=$((failures + 1)); }

# Nothing skipped. Without this control a summary that always warned would pass
# every case below.
out=$(summarise_run "")
if [[ "$out" != *"all checks passed"* ]]; then
  fail 'a complete run' "did not say it passed: $out"
elif [[ "$out" == *"not run"* ]]; then
  fail 'a complete run' "claimed something was skipped: $out"
else
  ok 'a complete run says all checks passed'
fi

# The real case: four checks skipped because nothing was serving.
out=$(summarise_run 'fonts, mobile navigation, visual regression, style parity' 'nothing serving')
if [[ "$out" == *"all checks passed"* ]]; then
  fail 'a skipped run' "still read as a complete pass: $out"
elif [[ "$out" != *"4 not run"* ]]; then
  fail 'a skipped run' "did not count what it skipped: $out"
elif [[ "$out" != *"visual regression"* ]]; then
  fail 'a skipped run' "did not name what it skipped: $out"
elif [[ "$out" != *"nothing serving"* ]]; then
  fail 'a skipped run' "did not say why: $out"
else
  ok 'a skipped run names the four it did not run, and why'
fi

# One skipped, not four — the style-parity-only path, when a server is up but
# the gp-sphinx twin is missing.
out=$(summarise_run 'style parity' 'no gp-sphinx page')
if [[ "$out" != *"1 not run: style parity"* ]]; then
  fail 'one skipped' "miscounted or misnamed: $out"
else
  ok 'one skipped check is reported as one'
fi

# Whitespace is not a skipped check.
out=$(summarise_run '   ')
if [[ "$out" != *"all checks passed"* ]]; then
  fail 'blank skip list' "treated whitespace as a skipped check: $out"
else
  ok 'a blank skip list is not a skipped check'
fi

if [ "$failures" -gt 0 ]; then
  printf '\nthe run summary cannot distinguish %d of the cases it exists for.\n' "$failures"
  exit 1
fi
printf '\ncheck-summary.negative: a skipped run never reads as a complete one\n'
