#!/usr/bin/env bash
#
# Regenerate the selected port's API model, staged guides and usage data from
# its checkout, as a source-bound port publish does. build-site.sh runs this
# after staging the cached guides; the scheduled port-heads workflow runs it
# against each port's default-branch head, so a port change that breaks
# staging fails there instead of in the port's own release.
#
# Reads LIBTMUX_DOCS_PORT, LIBTMUX_DOCS_SOURCE_SHA and the port's
# LIBTMUX_DOCS_CHECKOUT_<PORT>. Run from any directory.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
site_dir="$(cd "$script_dir/.." && pwd)/site"

if [ -n "${LIBTMUX_DOCS_PORT:-}" ] && { [ "$LIBTMUX_DOCS_PORT" = ruby ] || [ "$LIBTMUX_DOCS_PORT" = lua ]; }; then
  node "$script_dir/gen-api-model.mjs" --port "$LIBTMUX_DOCS_PORT"
  node "$script_dir/stage-port-docs.mjs" --port "$LIBTMUX_DOCS_PORT"
elif [ -n "${LIBTMUX_DOCS_SOURCE_SHA:-}" ] && { [ "$LIBTMUX_DOCS_PORT" = powershell ] || [ "$LIBTMUX_DOCS_PORT" = julia ] ||
  [ "$LIBTMUX_DOCS_PORT" = elixir ] || [ "$LIBTMUX_DOCS_PORT" = ocaml ] || [ "$LIBTMUX_DOCS_PORT" = haskell ] || [ "$LIBTMUX_DOCS_PORT" = perl ] || [ "$LIBTMUX_DOCS_PORT" = lisp ] || [ "$LIBTMUX_DOCS_PORT" = erlang ]; }; then
  node "$script_dir/gen-api-model.mjs" --port "$LIBTMUX_DOCS_PORT"
  node "$script_dir/stage-port-docs.mjs" --port "$LIBTMUX_DOCS_PORT" --from-source
  node "$script_dir/gen-api-model.mjs" --port "$LIBTMUX_DOCS_PORT" --nav
  if [ "$LIBTMUX_DOCS_PORT" = haskell ]; then
    node "$script_dir/gen-tmux-usage.mjs" --ports "$LIBTMUX_DOCS_PORT" --source
  fi
elif [ -n "${LIBTMUX_DOCS_SOURCE_SHA:-}" ] && node --input-type=module -e '
  const { PORT_BY_SLUG } = await import("file://'"$site_dir"'/src/lib/ports.ts");
  process.exit(PORT_BY_SLUG[process.env.LIBTMUX_DOCS_PORT]?.parentLibrary ? 0 : 1);
'; then
  node "$script_dir/stage-port-docs.mjs" --port "$LIBTMUX_DOCS_PORT" --from-source
  node "$script_dir/gen-api-model.mjs" --port "$LIBTMUX_DOCS_PORT"
elif [ -n "${LIBTMUX_DOCS_SOURCE_SHA:-}" ]; then
  # A source-bound build renders the reference from the verified checkout,
  # not from the model committed here, which describes whatever revision was
  # last refreshed. The generator re-checks the SHA and records it.
  node "$script_dir/gen-api-model.mjs" --port "$LIBTMUX_DOCS_PORT"
  node "$script_dir/gen-api-model.mjs" --port "$LIBTMUX_DOCS_PORT" --nav
fi
if [ "${LIBTMUX_DOCS_PORT:-}" = perl ] && [ -n "${LIBTMUX_DOCS_SOURCE_SHA:-}" ]; then
  node "$script_dir/gen-tmux-usage.mjs" --ports perl
fi
node "$script_dir/stage-port-docs.mjs" --wrappers
if [ -n "${LIBTMUX_DOCS_SOURCE_SHA:-}" ]; then
  if [ "$LIBTMUX_DOCS_PORT" = clojure ]; then
    # gen-tmux-usage also reads the Java core the wrapper stands on; the
    # checkout resolver (scripts/lib/port-checkout.mjs) serves it from the
    # wrapper's own checkout, which is the Java repository.
    node "$script_dir/gen-tmux-usage.mjs" --ports clojure
  fi
fi
