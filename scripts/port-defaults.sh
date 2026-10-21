#!/usr/bin/env bash
# The default version of every port, as JSON, before anything is built.
#
# build-site.sh derives these from the version manifest and exports them to
# every shell build it runs. This sources the same bookkeeping, so the answer
# cannot differ from the build's. The publication audit renders the root
# locales while the assembly is still building, and those renders read it.
#
# The assembly trims the manifest to the trees it produced, which can move a
# default; `test-all.sh --stage output` fails when that happened.
#
# Usage: scripts/port-defaults.sh [versions]   (default: latest,stable)
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
site_dir="$repo_root/site"
locale="${LIBTMUX_DOCS_LOCALE:-en}"
versions_arg="${1:-latest,stable}"

warn() { printf 'port-defaults: warning: %s\n' "$*" >&2; }
die() {
  printf 'port-defaults: error: %s\n' "$*" >&2
  exit 1
}

scratch="$(mktemp -d "${TMPDIR:-/tmp}/libtmux-port-defaults.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

# shellcheck source=scripts/version-bookkeeping.sh
. "$script_dir/version-bookkeeping.sh"

printf '%s\n' "$LIBTMUX_DOCS_PORT_DEFAULTS"
