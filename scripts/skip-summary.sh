#!/usr/bin/env bash
# The last line of a test run, which has to say what did not run.
#
# Four checks here need a served site: fonts, mobile navigation, visual
# regression and style parity. Nothing serves one in CI, and often nothing is
# serving locally either, so the run skips them. That is by design — failing
# would mean CI could never pass — and it is not the problem.
#
# The problem was the last line. A run that skipped four of its checks still
# ended "all checks passed", which is the line a reader takes away, and it was
# not true of that run. A rendering regression can land under it: the four
# checks that would have caught one are exactly the four that skip.
#
# So the summary names them. Exit status is unchanged, because whether the
# checks ran is a different question from whether anything failed.

# summarise_run <comma-separated skipped names> [reason]
summarise_run() {
  local skipped="${1:-}" reason="${2:-}" n

  if [ -z "${skipped//[[:space:]]/}" ]; then
    printf '\n\033[1mall checks passed\033[0m\n'
    return 0
  fi

  n=$(printf '%s' "$skipped" | tr ',' '\n' | grep -c '[^[:space:]]')
  printf '\n\033[1mchecks passed, %d not run: %s\033[0m\n' "$n" "$skipped"
  [ -n "$reason" ] && printf '%s\n' "$reason"
  return 0
}
