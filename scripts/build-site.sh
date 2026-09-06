#!/usr/bin/env bash
#
# Assemble the complete local libtmux.org site into _site/: the Astro
# shell (once for shared prose, once per self-hosted port x version), each
# self-hosted port's reference where its toolchain is present, and one
# Pagefind index over the whole tree.
#
# Runs end-to-end with only Node + pnpm on PATH. Every reference generator
# is optional — an absent toolchain is a skip, printed in the summary
# table, never a failed run. Ecosystem ports (Rust, Go, Java; see
# site/src/lib/ports.ts) produce no local output at all: the site links out
# to their canonical host.
#
# See scripts/README.md for usage.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/build-site.sh [options]

  --versions v1,v2,...  Version slugs to build per self-hosted port
                         (default: latest,stable)
  --ports p1,p2,...     Limit to these port slugs (default: all self-hosted
                         ports from site/src/lib/ports.ts)
  --skip-refs           Skip every reference generator (shell + search only)
  --no-cache            Rebuild every shell even if its inputs are unchanged
  --skip-pagefind       Skip the final Pagefind indexing pass
  -h, --help            Show this message
USAGE
}

versions_arg="latest,stable"
ports_filter=""
skip_refs=0
skip_pagefind=0

while [ $# -gt 0 ]; do
  case "$1" in
    --versions)
      versions_arg="$2"
      shift 2
      ;;
    --ports)
      ports_filter="$2"
      shift 2
      ;;
    --skip-refs)
      skip_refs=1
      shift
      ;;
    --skip-pagefind)
      skip_pagefind=1
      shift
      ;;
    --no-cache)
      no_cache=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "build-site.sh: unrecognised argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
site_dir="$repo_root/site"
# Overridable so a test can drive a real build without overwriting the tree the
# rest of the suite is checking. `check-versions.negative.sh` needs to run this
# script for its controls, and pointing it at _site left later checks reading a
# half-built site.
out_dir="${LIBTMUX_DOCS_OUT_DIR:-$repo_root/_site}"
site_origin="${LIBTMUX_DOCS_SITE:-https://libtmux.org}"

# Locale is the outermost segment, so every page this assembly renders lives
# under it. `$out_dir` stays the bucket root — logs and robots.txt belong
# there, above any locale — and `$site_out` is where the site itself goes.
locale="${LIBTMUX_DOCS_LOCALE:-en}"
site_out="$out_dir/$locale"
LIBTMUX_DOCS_ROOT="/$locale/"
export LIBTMUX_DOCS_ROOT

# Only one Astro build may run in this working tree at a time.
#
# Two concurrent assemblies interleave into `_site` and produce a tree whose
# pages and bundled `/_astro/*.js` come from different builds. Nothing reports
# it; it surfaces later as a component that "doesn't work" on a page whose
# script never rendered it, which has cost us hours twice.
#
# The guard used to be `pgrep -f build-site.sh`, which is unreliable in both
# directions: it matches the shell wrapper whose command line contains the
# pattern, and it matches a watcher waiting on the very thing it is testing
# for. It has reported a build running when none was, and none running while
# one was, on the same machine within an hour.
#
# flock answers the question the kernel already knows.
#
# The lock covers the whole working tree, not just `_site`. A build with its
# own `--outDir` looks parallel-safe and is not: every Astro build in this tree
# shares `site/.astro/`, so two of them race on the prerender chunks whatever
# their output directory. That has already produced an ERR_MODULE_NOT_FOUND on
# a chunk one build deleted while another was reading it. Scope the lock to the
# shared state, which is the tree.
lock_file="$repo_root/.build.lock"
mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
if ! flock --nonblock 9; then
  holder="$(cat "$lock_file" 2>/dev/null || true)"
  printf 'build-site: another assembly is writing %s%s\n' \
    "$out_dir" "${holder:+ (started $holder)}" >&2

  # Name the processes actually holding it. The lock outlives a SIGKILLed
  # script whenever a child inherited the descriptor — and a child that is
  # still running is still writing the tree, so continuing to block is right.
  # What is not right is leaving someone to guess why: without this, a hung
  # sphinx or astro reads as a stuck lock with no visible cause.
  if command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "$lock_file" 2>/dev/null | tr -s ' ')"
    if [ -n "${pids// /}" ]; then
      printf 'build-site: held by:\n' >&2
      for pid in $pids; do
        # This process holds the descriptor too, having just opened it.
        [ "$pid" = "$$" ] && continue
        line="$(ps -p "$pid" -o pid=,etime=,args= 2>/dev/null | cut -c1-100)"
        [ -n "${line// /}" ] && printf '  %s\n' "$line" >&2
      done
    fi
  fi
  printf 'build-site: wait for it to finish, or kill those and retry.\n' >&2
  exit 1
fi
# Recorded for the message above, never read for correctness — the lock is the
# lock. Nothing here has to clean up a stale file: the kernel drops the lock
# when the last descriptor closes, which is why this beats a lockfile we
# manage ourselves and why a SIGKILL cannot strand it.
printf '%s by pid %s\n' "$(date -Is)" "$$" >&9

# A version manager can leave a shadowing stub earlier on PATH than the real
# binary — e.g. an npm-installed `bun` inside node's bin dir whose postinstall
# never ran. toolchain_ready() correctly reports those as unusable, which is
# right but unhelpful when a working copy is sitting in a mise install dir.
# Prepend the newest working one so the generator runs instead of skipping.
prefer_working_toolchain() {
  local cmd="$1" candidate
  if "$cmd" --version >/dev/null 2>&1; then
    return 0
  fi
  for candidate in \
    "$HOME/.config/mise/installs/$cmd"/*/bin/"$cmd" \
    "$HOME/.local/share/mise/installs/$cmd"/*/bin/"$cmd"
  do
    [ -x "$candidate" ] || continue
    "$candidate" --version >/dev/null 2>&1 || continue
    PATH="$(dirname "$candidate"):$PATH"
    export PATH
    return 0
  done
  return 1
}

for _tool in bun go cargo; do
  prefer_working_toolchain "$_tool" || true
done
unset _tool

# docfx is a .NET global tool, so it needs two things `prefer_working_toolchain`
# cannot supply: DOTNET_ROOT (its apphost refuses to start without one — mise
# installs the SDK outside every location the host searches) and the global
# tools directory on PATH. Both are no-ops when .NET is not installed, so this
# stays silent on machines that will skip the port anyway.
prefer_dotnet_toolchain() {
  local candidate
  if [ -z "${DOTNET_ROOT:-}" ]; then
    for candidate in \
      "$HOME/.config/mise/installs/dotnet"/*/dotnet \
      "$HOME/.local/share/mise/installs/dotnet"/*/dotnet \
      /usr/share/dotnet/dotnet
    do
      [ -x "$candidate" ] || continue
      DOTNET_ROOT="$(dirname "$candidate")"
      export DOTNET_ROOT
      break
    done
  fi
  [ -n "${DOTNET_ROOT:-}" ] || return 0
  case ":$PATH:" in
    *":$DOTNET_ROOT:"*) ;;
    *) PATH="$DOTNET_ROOT:$PATH" ;;
  esac
  [ -d "$HOME/.dotnet/tools" ] && case ":$PATH:" in
    *":$HOME/.dotnet/tools:"*) ;;
    *) PATH="$HOME/.dotnet/tools:$PATH" ;;
  esac
  export PATH
  # docfx reads global.json from its own working directory; the .NET docs
  # worktree pins an SDK with rollForward disabled, and telemetry/logo noise
  # would otherwise land in the generator log.
  export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
}
prefer_dotnet_toolchain

# Sweep scratch directories a previous run left behind.
#
# The EXIT trap below handles a normal exit and an ordinary interrupt, and
# cannot handle SIGKILL — which is what a `pkill -9` on a stuck assembly
# sends. Seven abandoned directories totalling 815 MB accumulated that way on
# a disk that then hit 100% full, which failed a Swift DocC build with
# ENOSPC and looked for all the world like a toolchain problem.
#
# So: clean up after the runs that could not clean up after themselves. Only
# directories older than an hour, so a concurrent assembly's scratch is never
# removed out from under it.
find "${TMPDIR:-/tmp}" -maxdepth 1 -type d -name 'libtmux-docs-build.*' -mmin +60 \
  -exec rm -rf {} + 2>/dev/null || true

scratch="$(mktemp -d "${TMPDIR:-/tmp}/libtmux-docs-build.XXXXXX")"
# INT and TERM as well as EXIT: a plain `kill` or a Ctrl-C should still clean
# up. SIGKILL cannot be trapped by anything, which is what the sweep above is
# for.
trap 'rm -rf "$scratch"' EXIT INT TERM

log() { printf '==> %s\n' "$*" >&2; }
warn() { printf 'build-site: warning: %s\n' "$*" >&2; }
die() {
  printf 'build-site: error: %s\n' "$*" >&2
  exit 1
}

contains() {
  # contains LIST NEEDLE — LIST is comma-separated, empty LIST means "all".
  [ -z "$1" ] && return 0
  case ",$1," in
    *",$2,"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

command -v node >/dev/null 2>&1 || die "node is required and was not found on PATH"
command -v pnpm >/dev/null 2>&1 || die "pnpm is required and was not found on PATH"

if [ ! -d "$site_dir/node_modules" ]; then
  log "site/node_modules missing — running pnpm install"
  (cd "$repo_root" && pnpm install --frozen-lockfile)
fi

rm -rf "$out_dir"
mkdir -p "$out_dir"

# ---------------------------------------------------------------------------
# Shell build cache.
#
# The assembly runs the same Astro build fourteen times with different
# environment variables, and every one of them takes ten seconds whether or
# not a byte of input changed. The cache is content-addressed: the key is a
# digest of every file a build reads, folded together with that build's own
# parameters, so a hit is only possible when the output would be identical.
#
# It lives outside $out_dir because $out_dir is wiped above, and it is
# content-addressed rather than timestamped because timestamps are what made
# Astro's own content cache serve a stale page after a plugin changed: mtime
# says a file was written, not what is in it.
# ---------------------------------------------------------------------------
cache_dir="${LIBTMUX_DOCS_CACHE:-$repo_root/.build-cache}"
no_cache="${no_cache:-0}"
if [ "$no_cache" -eq 1 ]; then
  base_fingerprint="no-cache-$(date +%s%N)"
else
  base_fingerprint="$(node "$script_dir/fingerprint.mjs")"
  mkdir -p "$cache_dir"
  # Every edit to a hashed file makes a whole new generation of entries, and
  # a generation is roughly 200 MB. Entries are pruned by age rather than by
  # count because age is what "no longer any branch you are working on" looks
  # like; a fortnight is long enough to switch between two branches all week
  # and still get hits on both. `rm -rf .build-cache` is always safe.
  find "$cache_dir" -maxdepth 1 -mindepth 1 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true
fi
# Counted in files, not variables. `build_reference` is invoked through
# command substitution to capture its status line, and a shell variable
# incremented inside that subshell is lost — the first version of this
# reported "14 cached" for eighteen calls.
cache_stats="$scratch/cache-stats"
: >"$cache_stats"
note_cache() { printf '%s\n' "$1" >>"$cache_stats"; }

# ---------------------------------------------------------------------------
# Port metadata, read from ports.ts (the source of truth) rather than
# duplicated here. Emits one '|'-separated line per port:
#   slug|name|versionedDocs|renderer|generator|checkout|ecosystemHostName
#
# '|' rather than a tab: bash's `read` collapses runs of IFS *whitespace*
# (space/tab/newline) and drops empty fields between them, which silently
# shifts every column after the first empty one — ecosystem ports have an
# empty `generator`, so a tab delimiter would misalign checkout/host on
# every one of them. '|' is not IFS whitespace, so empty fields survive.
# Empty values are also written as '-' as a second line of defense.
# ---------------------------------------------------------------------------

list_ports() {
  LIBTMUX_DOCS_REPO_ROOT="$repo_root" node --input-type=module <<'NODE'
const repoRoot = process.env.LIBTMUX_DOCS_REPO_ROOT
const { PORTS } = await import(new URL('site/src/lib/ports.ts', `file://${repoRoot}/`).href)
for (const p of PORTS) {
  const fields = [p.slug, p.name, p.versionedDocs ? 'versioned' : 'unversioned', p.renderer, p.generator, p.checkout, p.ecosystemHost?.name ?? '']
  process.stdout.write(fields.map((f) => (String(f).trim() || '-').replaceAll('|', ' ')).join('|') + '\n')
}
NODE
}

# ---------------------------------------------------------------------------
# Version bookkeeping
# ---------------------------------------------------------------------------

manifest="$scratch/versions.json"
node "$script_dir/gen-versions.mjs" --out "$manifest"

default_version_for() {
  LIBTMUX_DOCS_MANIFEST="$manifest" LIBTMUX_DOCS_PORT="$1" node -e '
    const fs = require("node:fs")
    const m = JSON.parse(fs.readFileSync(process.env.LIBTMUX_DOCS_MANIFEST, "utf8"))
    process.stdout.write(m.defaultVersion[process.env.LIBTMUX_DOCS_PORT] ?? "stable")
  '
}

# Whether this port's manifest actually lists a version slug.
#
# `stable` is absent for a port with no release, so building one would serve a
# tree the switcher does not list and the reader cannot reach by any offered
# route. site/test/site-pruning.test.ts asserts the two agree.
port_lists_version() {
  LIBTMUX_DOCS_MANIFEST="$manifest" LIBTMUX_DOCS_PORT="$1" LIBTMUX_DOCS_VERSION_SLUG="$2" node -e '
    const fs = require("node:fs")
    const m = JSON.parse(fs.readFileSync(process.env.LIBTMUX_DOCS_MANIFEST, "utf8"))
    const entries = m.ports[process.env.LIBTMUX_DOCS_PORT] ?? []
    process.exit(entries.some((e) => e.slug === process.env.LIBTMUX_DOCS_VERSION_SLUG) ? 0 : 1)
  '
}

# Every port's default version, as JSON, for the components that link across
# ports. `stable` is not a safe constant any more: a port with no release has
# no stable entry, so a switcher hard-coding it links at a tree nothing builds.
port_defaults_json() {
  LIBTMUX_DOCS_MANIFEST="$manifest" node -e '
    const fs = require("node:fs")
    const m = JSON.parse(fs.readFileSync(process.env.LIBTMUX_DOCS_MANIFEST, "utf8"))
    process.stdout.write(JSON.stringify(m.defaultVersion))
  '
}

kind_for_version() {
  case "$1" in
    latest) echo trunk ;;
    stable) echo alias ;;
    pr-*) echo pr ;;
    v*.x) echo branch ;;
    v*.*.*) echo tag ;;
    *)
      warn "unrecognised version slug '$1' — treating as kind 'branch'"
      echo branch
      ;;
  esac
}

LIBTMUX_DOCS_PORT_DEFAULTS="$(port_defaults_json)"
export LIBTMUX_DOCS_PORT_DEFAULTS

IFS=',' read -r -a versions <<<"$versions_arg"

# A slug that names a source other than HEAD would be a lie.
#
# `$version` reaches the URL, the cache key and the version switcher. It never
# reaches git: `build_reference_cached` fingerprints `rev-parse HEAD`, and no
# path here checks anything out. So every version this script builds renders
# the checkout as it currently stands.
#
# `latest` says exactly that, and `stable` is an alias, so both are honest.
# A tag, a maintenance branch or a PR slug all name a source this script cannot
# fetch, and building one publishes today's tree at /py/v0.62.0/ or /py/v0.6.x/
# as though it were that release — indistinguishable from a real archive.
#
# docs.rs and javadoc archive every release because they build each from its own
# source at publish time. Doing that here means a checkout per version, and old
# sources building under current tooling. Until that exists, refuse the slug
# rather than fabricate the page.
for version in "${versions[@]}"; do
  case "$(kind_for_version "$version")" in
    trunk | alias) ;;
    *)
      die "cannot build '$version': this script renders the checkout at HEAD and
  never checks anything out, so this slug would publish current content at
  /<port>/$version/ as though it came from that source. Use latest or stable."
      ;;
  esac
done

# ---------------------------------------------------------------------------
# One Astro build invocation. All build-time identity is env vars, per
# astro.config.ts and site/src/lib/versions.ts's buildTarget() — there is no
# CLI flag for base/site/version on `astro build` (Astro 7).
# ---------------------------------------------------------------------------

build_shell() {
  local base="$1" version="$2" kind="$3" is_default="$4" default_version="$5" outdir="$6"
  mkdir -p "$outdir"

  local key cached
  key="$(printf '%s|%s|%s|%s|%s|%s|%s|%s' \
    "$base_fingerprint" "$base" "$version" "$kind" "$is_default" "$default_version" \
    "${LIBTMUX_DOCS_PORT:-}" "${LIBTMUX_DOCS_PORT_DEFAULTS:-}" | sha256sum | cut -c1-40)"
  cached="$cache_dir/shell-$key"
  if [ "$no_cache" -eq 0 ] && [ -d "$cached" ]; then
    cp -a "$cached/." "$outdir/"
    touch "$cached"
    note_cache shell-hit
    log "cached: $base ($version)"
    return 0
  fi
  note_cache shell-miss

  (
    cd "$site_dir"
    LIBTMUX_DOCS_BASE="$base" \
      LIBTMUX_DOCS_ROOT="${LIBTMUX_DOCS_ROOT:-/}" \
      LIBTMUX_DOCS_SITE="$site_origin" \
      LIBTMUX_DOCS_PORT_DEFAULTS="${LIBTMUX_DOCS_PORT_DEFAULTS:-}" \
      LIBTMUX_DOCS_VERSION="$version" \
      LIBTMUX_DOCS_VERSION_KIND="$kind" \
      LIBTMUX_DOCS_IS_DEFAULT="$is_default" \
      LIBTMUX_DOCS_DEFAULT_VERSION="$default_version" \
      LIBTMUX_DOCS_SKIP_PAGEFIND=true \
      LIBTMUX_DOCS_PORT="${LIBTMUX_DOCS_PORT:-}" \
      pnpm exec astro build --outDir "$outdir"
  )

  # Populate through a temporary directory and rename, so an interrupted copy
  # never leaves a half-written tree that a later run would treat as a hit.
  if [ "$no_cache" -eq 0 ]; then
    rm -rf "$cached" "$cached.partial"
    mkdir -p "$cached.partial"
    cp -a "$outdir/." "$cached.partial/" && mv "$cached.partial" "$cached"
  fi
}

# ---------------------------------------------------------------------------
# Reference generators, one per self-hosted renderer. Each prints exactly
# one tab-separated "status<TAB>reason" line to stdout and does its own
# toolchain/entrypoint detection so an absent tool degrades to a skip
# instead of aborting the run.
#
# Status values:
#   built       generator produced final HTML, copied to <port>/<version>/api/
#   model-only  generator produced an intermediate model (JSON/YAML/Markdown)
#               that the shell has no page route to render yet — nothing is
#               copied, see the contradiction this is flagged with in the
#               PR/summary
#   skipped     toolchain absent, unusable (see toolchain_ready below), or
#               the generator's entrypoint/config isn't in the checkout yet
#   failed      toolchain usable, generator invoked, exited non-zero
# ---------------------------------------------------------------------------

find_first() {
  # find_first DIR NAME_PATTERN MAXDEPTH — first match of `find -name`, or empty.
  find "$1" -maxdepth "$3" -name "$2" -print 2>/dev/null | head -n1
}

toolchain_broken_reason=""
toolchain_ready() {
  # toolchain_ready CMD [VERSION_ARG] — true only if CMD both resolves on
  # PATH *and* actually runs. A binary that resolves but fails its own
  # version check (observed here: an npm-installed `bun` shim whose
  # postinstall never ran, in a sandbox that skips postinstall scripts) is
  # "absent" for this script's purposes, not "present but the generator is
  # broken" — sets toolchain_broken_reason with the first line of output
  # when that distinction matters for the skip message.
  #
  # The third argument is a directory to probe from, and it matters for any
  # version manager that resolves per-directory. mise picks the toolchain from
  # the nearest `.tool-versions`, and only the port's own checkout pins one —
  # so `swift --version` run from this repository fails with "No version is
  # set for shim: swift" while the very same command inside libtmux-swift
  # reports 6.2.4. Probing here rather than there reported Swift as absent on
  # a machine that had it, and skipped its reference silently.
  local cmd="$1" version_arg="${2:---version}" probe_dir="${3:-}"
  toolchain_broken_reason=""
  if ! command -v "$cmd" >/dev/null 2>&1; then
    return 1
  fi
  local out
  if out="$(cd "${probe_dir:-.}" && "$cmd" "$version_arg" 2>&1)"; then
    return 0
  fi
  toolchain_broken_reason="${out%%$'\n'*}"
  return 1
}

# render_markdown_reference SLUG VERSION OUTDIR SRC_MD TITLE GENERATOR
#
# Ports whose generator emits Markdown (rather than a finished HTML site) are
# rendered by the shell itself, so they inherit the layout, theme, search and
# version switcher instead of landing as an unstyled island. The file is
# staged into the `api` content collection, then the shell is rebuilt with
# LIBTMUX_DOCS_PORT set so only this port's reference is emitted.
render_markdown_reference() {
  local slug="$1" version="$2" outdir="$3" src_md="$4" title="$5" generator="$6"
  local repo="${7:-libtmux/libtmux-$slug}"
  [ -f "$src_md" ] || { echo "no generated markdown at $src_md" >&2; return 1; }

  local staged="$site_dir/src/content/api/$slug"
  rm -rf "$staged"
  mkdir -p "$staged"
  {
    printf -- '---\n'
    printf 'title: "%s"\n' "$title"
    printf 'port: "%s"\n' "$slug"
    printf 'generator: "%s"\n' "$generator"
    printf -- '---\n\n'
    # Drop the source file's own H1 (the layout renders the title already),
    # then repoint links that are relative to the generator's own repo layout.
    # `../README.md` resolves inside that checkout, not on this site, so it
    # would 404 here; send it to the file on GitHub instead.
    sed -e '0,/^# /{/^# /d;}' \
        -e "s#](\.\./README\.md)#](https://github.com/${repo}/blob/HEAD/README.md)#g" \
        -e "s#](\./README\.md)#](https://github.com/${repo}/blob/HEAD/README.md)#g" \
        "$src_md"
  } >"$staged/index.md"

  render_staged_reference "$slug" "$version" "$outdir"
}

# render_markdown_tree_reference SLUG VERSION OUTDIR SRC_DIR
#
# The multi-file sibling of render_markdown_reference. docfx emits one
# Markdown file per type rather than one file per library, so the staging step
# is a script (scripts/stage-docfx.mjs) rather than a sed pipeline: sibling
# `Foo.md` hrefs and docfx's `<xref>` element both have to be rewritten, and
# an index has to be synthesised, before any of it is valid Astro content.
render_markdown_tree_reference() {
  local slug="$1" version="$2" outdir="$3" src_dir="$4"
  [ -d "$src_dir" ] || { echo "no generated markdown tree at $src_dir" >&2; return 1; }

  local staged="$site_dir/src/content/api/$slug"
  node "$repo_root/scripts/stage-docfx.mjs" "$src_dir" "$staged" "$slug" || return 1
  render_staged_reference "$slug" "$version" "$outdir"
}

# render_staged_reference SLUG VERSION OUTDIR
#
# Builds the shell once with LIBTMUX_DOCS_PORT set and lifts its api/ tree into
# the assembled output. Shared by both staging paths above; the only thing they
# disagree about is how src/content/api/<slug>/ got populated.
render_staged_reference() {
  local slug="$1" version="$2" outdir="$3"
  local staged="$site_dir/src/content/api/$slug"
  local build_out="$scratch/api-$slug-$version"
  local rc=0
  rm -rf "$build_out"
  LIBTMUX_DOCS_PORT="$slug" build_shell \
    "/$locale/$slug/$version/" "$version" "$(kind_for_version "$version")" \
    false "$version" "$build_out" || rc=$?

  if [ "$rc" -eq 0 ] && [ -d "$build_out/api" ]; then
    mkdir -p "$outdir"
    cp -R "$build_out/api/." "$outdir/"
  else
    rc=1
    echo "shell build produced no api/ directory" >&2
  fi
  rm -rf "$staged"
  return "$rc"
}

# build_reference_cached SLUG CHECKOUT VERSION OUTDIR
#
# `build_reference` around a content-addressed cache. Sphinx, Doxygen, docfx
# and DocC account for most of an assembly's wall clock and none of them is
# incremental across a wiped output directory, so a rebuild that changed
# nothing in a port's source repaid the whole cost.
#
# The key is the port checkout's commit and working-tree state folded together
# with this repo's own fingerprint — the second half matters because the
# Doxyfile, the Sphinx conf augmentation and the staging scripts all live here
# and all change the output.
#
# The status line is cached alongside the tree. It is what the summary prints,
# and a hit that reported "built" for a generator that had been skipped would
# be a lie that survives until someone reads the site.
# write_reference_redirect SLUG DEST
#
# A static site has no server to answer 301 with, so the redirect is a page:
# a meta refresh for the browser, a canonical link so a crawler follows the
# same edge, and a visible link for anyone whose browser refuses the refresh.
# `noindex` keeps the placeholder out of search results while the canonical
# still points at the real page.
write_reference_redirect() {
  local slug="$1" dest="$2"
  # Through the site root, like every other link the assembly emits.
  local target="${site_origin%/}/$locale/reference/$slug/"
  cat >"$dest" <<HTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>API reference moved</title>
    <link rel="canonical" href="$target" />
    <meta name="robots" content="noindex, follow" />
    <meta http-equiv="refresh" content="0; url=/$locale/reference/$slug/" />
  </head>
  <body>
    <p>This reference now lives at <a href="/$locale/reference/$slug/">/$locale/reference/$slug/</a>.</p>
  </body>
</html>
HTML
}

build_reference_cached() {
  local slug="$1" checkout="$2" version="$3" outdir="$4"
  if [ "$no_cache" -eq 1 ]; then
    build_reference "$slug" "$checkout" "$version" "$outdir"
    return
  fi

  # The directory the generator reads, which is usually the `-docs` worktree
  # and not the checkout. Keying on the checkout meant the cxx entry ignored
  # the Doxyfile that produces it, and the py entry tracked a branch that has
  # nothing to do with the docs build.
  local src rev
  src="$(reference_source_dir "$slug" "$checkout")"
  rev="absent"
  if git -C "$src" rev-parse --git-dir >/dev/null 2>&1; then
    rev="$(git -C "$src" rev-parse HEAD 2>/dev/null || echo unknown)"
    rev="$rev-$(git -C "$src" status --porcelain 2>/dev/null | sha256sum | cut -c1-12)"
  fi

  local key cached
  key="$(printf '%s|%s|%s|%s' "$base_fingerprint" "$slug" "$version" "$rev" |
    sha256sum | cut -c1-40)"
  cached="$cache_dir/ref-$key"

  if [ -f "$cached/.status" ]; then
    mkdir -p "$outdir"
    # `.status` and `.log` are metadata about the cache entry, not part of
    # the reference.
    (cd "$cached" && tar cf - --exclude=./.status --exclude=./.log .) |
      (cd "$outdir" && tar xf -)
    # The status line this returns says "see <log file>". On the first cached
    # run the generator does not write one, so that pointer led nowhere —
    # a build log that exists only when the build was slow is the kind of
    # observability that disappears exactly when it is wanted.
    if [ -f "$cached/.log" ]; then
      mkdir -p "$out_dir/.build-logs"
      cp "$cached/.log" "$out_dir/.build-logs/$slug-$version.log"
    fi
    # Touch on hit: the prune is by age, and an entry used every day would
    # otherwise be deleted on its fifteenth.
    touch "$cached"
    note_cache ref-hit
    cat "$cached/.status"
    return 0
  fi

  local result rc=0
  result="$(build_reference "$slug" "$checkout" "$version" "$outdir")" || rc=$?
  note_cache ref-miss
  printf '%s' "$result"

  # Only a successful build is worth keeping. A skip is cheap to repeat and
  # depends on toolchain availability, which is not in the key.
  if [ "$rc" -eq 0 ] && [ "${result%%$'\t'*}" = "built" ] && [ -d "$outdir" ]; then
    rm -rf "$cached" "$cached.partial"
    mkdir -p "$cached.partial"
    if cp -a "$outdir/." "$cached.partial/"; then
      printf '%s' "$result" >"$cached.partial/.status"
      [ -f "$out_dir/.build-logs/$slug-$version.log" ] &&
        cp "$out_dir/.build-logs/$slug-$version.log" "$cached.partial/.log"
      mv "$cached.partial" "$cached"
    else
      rm -rf "$cached.partial"
    fi
  fi
  return "$rc"
}

# reference_source_dir SLUG CHECKOUT — the directory a generator actually reads.
#
# Each port has a sibling worktree on the `docs-site` branch (see
# notes/adding-a-port.md). Documentation config that does not belong on the
# port's default branch lives there, so it wins when it carries the
# generator's entrypoint, and the checkout is the fallback.
#
# A function rather than a few lines inside `build_reference`, because the
# cache key has to agree with it. Keyed on the checkout while the build read
# the worktree, editing `libtmux-cxx-docs/Doxyfile` would not have
# invalidated anything, and a commit on the user's unrelated in-progress
# branch would have invalidated everything.
reference_source_dir() {
  local slug="$1" checkout="$2"
  local expanded="${checkout/#\~/$HOME}"
  local worktree="${expanded}-docs"
  case "$slug" in
    py) worktree="$HOME/work/python/libtmux-python-docs" ;;
  esac
  if [ -d "$worktree" ]; then
    case "$slug" in
      py | cxx) [ -f "$worktree/docs/conf.py" ] && expanded="$worktree" ;;
      dotnet) [ -f "$worktree/docfx.json" ] && expanded="$worktree" ;;
    esac
  fi
  printf '%s' "$expanded"
}

build_reference() {
  local slug="$1" checkout="$2" version="$3" outdir="$4"
  local checkout_expanded
  checkout_expanded="$(reference_source_dir "$slug" "$checkout")"
  # Logs live under $out_dir, not $scratch, so they survive the trap
  # cleanup and the summary's "see <path>" pointers stay valid after the
  # script exits. Pagefind only indexes .html, so a stray .log tree is
  # harmless in the assembled output.
  mkdir -p "$out_dir/.build-logs"
  local log_file="$out_dir/.build-logs/$slug-$version.log"

  if [ ! -d "$checkout_expanded" ]; then
    printf 'skipped\tcheckout not found at %s\n' "$checkout"
    return
  fi

  case "$slug" in
    py)
      if ! toolchain_ready uv; then
        printf 'skipped\tuv not usable (needed to run sphinx-build)%s\n' "${toolchain_broken_reason:+: $toolchain_broken_reason}"
        return
      fi
      if [ ! -f "$checkout_expanded/docs/conf.py" ]; then
        printf 'skipped\tno docs/conf.py in checkout\n'
        return
      fi
      # Federate this port's Sphinx build with the other seven, so a
      # docstring can write `:ref:`libtmux-go:tmux.Server.Sessions``. Only
      # into a worktree: `checkout_expanded` is upstream's own checkout when
      # no worktree was made, and this repo does not edit that.
      # Truncate first, then append: `sphinx-build` below redirects with a
      # single `>`, which silently discarded this step's own output.
      : >"$log_file"
      # The worktree is a checkout of someone else's repository, with its own
      # remotes — this repo neither creates it nor owns it. Augmenting
      # `conf.py` in place is the only way to reach Sphinx's config without a
      # `-c` that would break every path the file resolves relative to itself,
      # so the file is put back afterwards, on success or failure alike.
      # Left modified it carried absolute local paths into a tracked file, one
      # `git commit -a` from leaving the machine.
      local conf_backup=""
      if [ -f "$checkout_expanded/docs/conf.py" ]; then
        conf_backup="$scratch/conf-$slug-$version.py"
        cp "$checkout_expanded/docs/conf.py" "$conf_backup"
        node "$script_dir/add-intersphinx.mjs" \
          "$checkout_expanded/docs" "$out_dir" "$site_origin" "$slug" >>"$log_file" 2>&1 || true
      fi
      restore_conf() {
        [ -n "$conf_backup" ] && [ -f "$conf_backup" ] &&
          cp "$conf_backup" "$checkout_expanded/docs/conf.py"
      }
      # Doctrees are Sphinx's own incremental-build cache, not output — they
      # go in $scratch so `cp -a "$outdir/." "$port_out/api/"` below never
      # ships pickled build state into the assembled site.
      if (cd "$checkout_expanded/docs" && uv run sphinx-build -q -b dirhtml -d "$scratch/doctrees-$slug-$version" . "$outdir") >>"$log_file" 2>&1; then
        restore_conf
        printf 'built\tSphinx dirhtml (see %s)\n' "$log_file"
      else
        restore_conf
        printf 'failed\tsphinx-build exited non-zero, see %s\n' "$log_file"
      fi
      ;;

    cxx)
      if ! toolchain_ready doxygen; then
        printf 'skipped\tdoxygen not usable%s\n' "${toolchain_broken_reason:+: $toolchain_broken_reason}"
        return
      fi
      if ! toolchain_ready uv; then
        printf 'skipped\tuv not usable%s\n' "${toolchain_broken_reason:+: $toolchain_broken_reason}"
        return
      fi
      local doxyfile
      doxyfile="$(find_first "$checkout_expanded" 'Doxyfile*' 3)"
      if [ -z "$doxyfile" ] || [ ! -f "$checkout_expanded/docs/conf.py" ]; then
        printf 'skipped\tno Doxygen+Breathe config in checkout yet\n'
        return
      fi
      # Doxygen XML and Sphinx doctrees are intermediate build state, not
      # output — kept in $scratch so only the final HTML tree in $outdir
      # gets copied into the assembled site below.
      local doxygen_xml="$scratch/doxygen-xml-$slug-$version"
      mkdir -p "$doxygen_xml"
      if ! (cd "$(dirname "$doxyfile")" && OUTPUT_DIRECTORY="$doxygen_xml" doxygen "$(basename "$doxyfile")") >"$log_file" 2>&1; then
        printf 'failed\tdoxygen exited non-zero, see %s\n' "$log_file"
        return
      fi
      # Federate with the other seven, as the Python build is. Backed up and
      # restored for the same reason: the worktree is a checkout of another
      # repository, and a tracked file left carrying absolute local paths is
      # one `git commit -a` from leaving the machine.
      local cxx_conf_backup=""
      if [ -f "$checkout_expanded/docs/conf.py" ]; then
        cxx_conf_backup="$scratch/conf-$slug-$version.py"
        cp "$checkout_expanded/docs/conf.py" "$cxx_conf_backup"
        node "$script_dir/add-intersphinx.mjs" \
          "$checkout_expanded/docs" "$out_dir" "$site_origin" "$slug" >>"$log_file" 2>&1 || true
      fi
      restore_cxx_conf() {
        [ -n "$cxx_conf_backup" ] && [ -f "$cxx_conf_backup" ] &&
          cp "$cxx_conf_backup" "$checkout_expanded/docs/conf.py"
      }
      # The C++ docs tree is not a Python project, so uv has no lockfile to
      # resolve from: name the doc dependencies explicitly.
      if (cd "$checkout_expanded/docs" && uv run \
        --with sphinx --with breathe --with furo \
        sphinx-build -q -b dirhtml \
        -D "breathe_projects.$slug=$doxygen_xml/xml" \
        -d "$scratch/doctrees-$slug-$version" . "$outdir") >>"$log_file" 2>&1; then
        restore_cxx_conf
        printf 'built\tDoxygen + Breathe + Sphinx dirhtml (see %s)\n' "$log_file"
      else
        restore_cxx_conf
        printf 'failed\tsphinx-build (breathe) exited non-zero, see %s\n' "$log_file"
      fi
      ;;

    ts)
      if ! toolchain_ready bun; then
        printf 'skipped\tbun not usable%s\n' "${toolchain_broken_reason:+: $toolchain_broken_reason}"
        return
      fi
      if [ ! -f "$checkout_expanded/packages/libtmux/scripts/generate-api-docs.ts" ]; then
        printf 'skipped\tno generate-api-docs.ts in checkout\n'
        return
      fi
      # This is the generator's own documented invocation (AGENTS.md: "Run
      # `bun run docs:api` and commit the result") — it writes docs/api.md
      # in the checkout, the same side effect `sphinx-build` has on py's
      # gitignored _build/ (only difference: this one output is tracked, so
      # a local assembly may leave a real diff in that sibling checkout).
      if ! (cd "$checkout_expanded/packages/libtmux" && bun run docs:api) >"$log_file" 2>&1; then
        printf 'failed\tbun run docs:api exited non-zero, see %s\n' "$log_file"
        return
      fi
      if render_markdown_reference "$slug" "$version" "$outdir" \
        "$checkout_expanded/packages/libtmux/docs/api.md" \
        "TypeScript API reference" \
        "@microsoft/api-extractor and the package's own generate-api-docs.ts" \
        "libtmux/libtmux-ts" \
        >>"$log_file" 2>&1
      then
        printf 'built\trendered through the shell at /%s/%s/api/\n' "$slug" "$version"
      else
        printf 'failed\tshell render of api.md failed, see %s\n' "$log_file"
      fi
      ;;

    dotnet)
      if ! toolchain_ready docfx; then
        printf 'skipped\tdocfx not usable%s\n' "${toolchain_broken_reason:+: $toolchain_broken_reason}"
        return
      fi
      if [ ! -f "$checkout_expanded/docfx.json" ]; then
        printf 'skipped\tno docfx.json in checkout yet\n'
        return
      fi
      # `--outputFormat markdown` (docfx >= 2.71) skips docfx's own site
      # generator entirely: it writes one Markdown file per type, which is
      # exactly the input the shell already knows how to render. Building
      # docfx's HTML instead would give this port a look no other port has.
      local docfx_out
      docfx_out="$(cd "$checkout_expanded" && node -e 'const c=require("./docfx.json");process.stdout.write(c.metadata[0].dest)' 2>/dev/null || echo '_docfx/api')"
      if ! (cd "$checkout_expanded" && docfx metadata docfx.json) >"$log_file" 2>&1; then
        printf 'failed\tdocfx metadata exited non-zero, see %s\n' "$log_file"
        return
      fi
      if render_markdown_tree_reference "$slug" "$version" "$outdir" \
        "$checkout_expanded/$docfx_out" >>"$log_file" 2>&1
      then
        printf 'built\trendered through the shell at /%s/%s/api/\n' "$slug" "$version"
      else
        printf 'failed\tshell render of the docfx Markdown tree failed, see %s\n' "$log_file"
      fi
      ;;

    swift)
      if ! toolchain_ready swift --version "$checkout_expanded"; then
        printf 'skipped\tswift not usable%s\n' "${toolchain_broken_reason:+: $toolchain_broken_reason}"
        return
      fi
      local docc_dir target_name
      docc_dir="$(find_first "$checkout_expanded/Sources" '*.docc' 2)"
      if [ -z "$docc_dir" ]; then
        printf 'skipped\tno .docc catalog under Sources/\n'
        return
      fi
      target_name="$(basename "$docc_dir" .docc)"
      mkdir -p "$outdir"
      # DocC bakes an absolute base path into every route (unlike the other
      # seven generators, which compute page-relative links), so this has to
      # run once per version rather than once per port and be copied — the
      # one generator here that genuinely cannot be built once and reused.
      if (cd "$checkout_expanded" && swift package --allow-writing-to-directory "$outdir" \
        generate-documentation --target "$target_name" \
        --output-path "$outdir" \
        --transform-for-static-hosting \
        --hosting-base-path "$slug/$version/api") >"$log_file" 2>&1; then
        printf 'built\tDocC (%s), see %s\n' "$target_name" "$log_file"
      else
        printf 'failed\tswift generate-documentation exited non-zero, see %s\n' "$log_file"
      fi
      ;;

    *)
      printf 'skipped\tno generator wired up for this port\n'
      ;;
  esac
}

# ---------------------------------------------------------------------------
# 1. Shared shell, shared prose — always built once, at the site root.
# ---------------------------------------------------------------------------

log "building shell root (shared prose)"
build_shell "/$locale/" "latest" "trunk" "true" "stable" "$site_out"

# Every port's home page (site/src/pages/[port]/index.astro) is built here,
# at the root, because its own getStaticPaths() only emits routes for the
# root base. Save each one now: an ecosystem port's prose pass below is a
# second full site build rooted at /<slug>/, and that build's own
# site/src/pages/index.astro (the main landing page, which carries no such
# guard) lands at exactly this port's index.html in the same output tree —
# clobbering the port home page just built with a copy of the site
# homepage. Restored after that pass; see below.
port_home_snapshots="$scratch/port-homes"
mkdir -p "$port_home_snapshots"
while IFS='|' read -r slug _name _versioned _renderer _generator _checkout _ecosystem_host; do
  [ -f "$site_out/$slug/index.html" ] && cp "$site_out/$slug/index.html" "$port_home_snapshots/$slug.html"
done < <(list_ports)

# gen-versions.mjs's derived manifest supersedes the static two-entry seed
# that the root build just copied from site/public/versions.json — the seed
# exists so the switcher works before any deploy has run this script at
# all; a local assembly can do better since the checkouts are right here.
#
# It is written now so the per-port builds below can read it, then rewritten
# at the end against what was actually assembled: a git tag is evidence that
# a release happened, not that its docs were published, and offering a reader
# a version that 404s is worse than not listing it.
cp "$manifest" "$site_out/versions.json"

# ---------------------------------------------------------------------------
# 2/3. Self-hosted ports: shell build per port x version, plus reference
# generation. Ecosystem ports get no local output — recorded for the
# summary table only.
# ---------------------------------------------------------------------------

summary_rows=()

while IFS='|' read -r slug name versioned renderer generator checkout ecosystem_host; do
  contains "$ports_filter" "$slug" || continue

  if [ "$versioned" != "versioned" ]; then
    # A port whose reference this site does not build. Its prose still
    # belongs here — /rs/concepts/transports/ is the Rust reading of that
    # page, and the language switcher links to it from every other port —
    # but a version number over prose alone would promise an archive that
    # does not exist.
    #
    # No port takes this branch today. Rust, Go and Java did while their
    # references lived on docs.rs, pkg.go.dev and javadoc; now that all
    # eight are built here, all eight are versioned, which is also what
    # every one of those ecosystems does. The branch stays because
    # `versionedDocs: false` stays supported, not because anything uses it.
    log "building $name ($slug) prose only (base=/$slug/, reference on $ecosystem_host)"
    LIBTMUX_DOCS_PORT="$slug" \
      build_shell "/$locale/$slug/" "stable" "alias" "false" "stable" "$site_out/$slug"
    # That build just overwrote this port's home page with a copy of the
    # site homepage — see the snapshot comment above. Put the real one back.
    [ -f "$port_home_snapshots/$slug.html" ] &&
      cp "$port_home_snapshots/$slug.html" "$site_out/$slug/index.html"
    summary_rows+=("$slug|-|$versioned|prose|one unversioned prose tree; see versionedDocs in ports.ts")
    continue
  fi

  default_version="$(default_version_for "$slug")"

  for version in "${versions[@]}"; do
    if ! port_lists_version "$slug" "$version"; then
      summary_rows+=("$slug|$version|-|not listed|no such version in this port's manifest")
      continue
    fi
    kind="$(kind_for_version "$version")"
    is_default=false
    [ "$version" = "$default_version" ] && is_default=true

    port_out="$site_out/$slug/$version"
    log "building $name ($slug)/$version (base=/$locale/$slug/$version/, kind=$kind, default=$is_default)"
    # LIBTMUX_DOCS_PORT is what makes this a *language* build rather than a
    # copy of the shared prose: the remark plugin drops every code fence
    # belonging to another port, and Seo/sidebar treat the page as that
    # port's own rather than a duplicate of the root's.
    LIBTMUX_DOCS_PORT="$slug" \
      build_shell "/$locale/$slug/$version/" "$version" "$kind" "$is_default" "$default_version" "$port_out"

    if [ "$skip_refs" -eq 1 ]; then
      summary_rows+=("$slug|$version|$renderer|skipped|--skip-refs")
      continue
    fi

    # One reference per port, at /reference/<slug>/.
    #
    # Five ports used to answer "the API" twice, in three different visual
    # systems: Breathe for C++, DocC for Swift, staged Markdown for TypeScript
    # and .NET, and this site's own components at /reference/. A reader
    # arriving at /cxx/stable/api/ met a page with no cards, no badges, no
    # source links and no prose, while /reference/cxx/ had all four.
    #
    # Python is the exception and stays generated. /py/stable/api/ is
    # gp-sphinx rendering upstream's own documentation — it is the thing this
    # reference is built to match, and the oracle
    # `site/scripts/check-style-parity.mjs` compares against. Deleting it
    # would delete the measurement.
    if [ "$slug" != "py" ]; then
      mkdir -p "$port_out/api"
      write_reference_redirect "$slug" "$port_out/api/index.html"
      summary_rows+=("$slug|$version|redirect|redirected|to /$locale/reference/$slug/")
      continue
    fi

    ref_outdir="$scratch/ref-$slug-$version"
    result="$(build_reference_cached "$slug" "$checkout" "$version" "$ref_outdir")"
    ref_status="${result%%$'\t'*}"
    ref_reason="${result#*$'\t'}"

    if [ "$ref_status" = "built" ]; then
      mkdir -p "$port_out/api"
      cp -a "$ref_outdir/." "$port_out/api/"
    fi

    summary_rows+=("$slug|$version|$renderer|$ref_status|[$generator] $ref_reason")
  done
done < <(list_ports)

# robots.txt is read only at the true origin root, whatever prefix the site
# itself sits under, so it is lifted out of the locale tree. Its own contents
# already name every path through the site root, so the copy needs no edit.
if [ -f "$site_out/robots.txt" ]; then
  cp "$site_out/robots.txt" "$out_dir/robots.txt"
fi

# ---------------------------------------------------------------------------
# 4. One Pagefind pass over the assembled tree, so search spans the shell,
# every Sphinx/DocC-rendered port and (once wired up) the Astro-rendered
# ones alike — Pagefind indexes rendered HTML and does not care which tool
# produced which page.
# ---------------------------------------------------------------------------

if [ "$skip_pagefind" -eq 0 ]; then
  log "indexing $site_out with Pagefind"
  (cd "$site_dir" && pnpm exec pagefind --site "$site_out")
else
  log "skipping Pagefind (--skip-pagefind)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Reconcile the manifest against what was actually assembled.
#
# gen-versions.mjs derives candidates from git refs; this trims them to the
# prefixes that exist in the output tree, so the switcher never offers a
# version that would 404. A port without a version tree gets an empty list:
# it has no /<port>/<version>/ prefix at all, so there is nothing to keep.
# ---------------------------------------------------------------------------
LIBTMUX_DOCS_OUT="$site_out" \
LIBTMUX_DOCS_UNVERSIONED="$(list_ports | awk -F'|' '$3 != "versioned" { printf "%s ", $1 }')" \
node -e '
  const fs = require("node:fs"), path = require("node:path")
  const out = process.env.LIBTMUX_DOCS_OUT
  const file = path.join(out, "versions.json")
  const m = JSON.parse(fs.readFileSync(file, "utf8"))
  const UNVERSIONED = new Set(process.env.LIBTMUX_DOCS_UNVERSIONED.split(" ").filter(Boolean))
  let dropped = 0
  for (const [port, entries] of Object.entries(m.ports)) {
    // No local version tree at all; an empty list keeps any consumer of the
    // manifest from linking into one. The list comes from ports.ts rather
    // than a second copy of the slugs, which is what it was: a literal
    // `new Set(["rs","go","java"])` that nothing checked against the type.
    if (UNVERSIONED.has(port)) { m.ports[port] = []; continue }
    const kept = entries.filter((e) => {
      if (fs.existsSync(path.join(out, port, e.slug, "index.html"))) return true
      dropped++
      return false
    })
    m.ports[port] = kept
    if (!kept.some((e) => e.slug === m.defaultVersion[port]) && kept.length) {
      m.defaultVersion[port] = kept[0].slug
    }
  }
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n")
  if (dropped) console.error(`  trimmed ${dropped} unpublished version entries from versions.json`)
'

printf '\n%-8s %-8s %-14s %-10s %s\n' "PORT" "VERSION" "MODE" "STATUS" "REASON"
had_failure=0
for row in "${summary_rows[@]}"; do
  IFS='|' read -r r_slug r_version r_mode r_status r_reason <<<"$row"

  printf '%-8s %-8s %-14s %-10s %s\n' "$r_slug" "$r_version" "$r_mode" "$r_status" "$r_reason"
  [ "$r_status" = "failed" ] && had_failure=1
done
printf '\nAssembled site: %s\n' "$out_dir"
printf 'Shell builds: %d cached, %d built\n' \
  "$(grep -c '^shell-hit$' "$cache_stats" || true)" \
  "$(grep -c '^shell-miss$' "$cache_stats" || true)"
printf 'References:   %d cached, %d built\n' \
  "$(grep -c '^ref-hit$' "$cache_stats" || true)" \
  "$(grep -c '^ref-miss$' "$cache_stats" || true)"

if [ "$had_failure" -eq 1 ]; then
  warn "one or more reference generators failed (toolchain present, build broke) — see per-port .log files above"
  exit 1
fi

# Only here is a whole-site link check meaningful. Every `/py/stable/` path is
# written by a different `astro build`, so any single build reports thousands
# of them missing and is right to; the assembly is the first moment all of
# them exist at once.
#
# A broken link from a page this repo generates fails the assembly. One from a
# vendored generator's own output is reported and does not, because we cannot
# fix Sphinx's genindex from here.
#
# That used to be a blanket warning, excused as "upstream output this repo
# does not control". True of Sphinx and docfx; never true of /reference/,
# which this repo generates — so the one class worth failing on was precisely
# the class being excused, and 52 broken links accumulated under it.
vendored_args=()
while IFS='|' read -r slug _name _versioned renderer _rest; do
  # 'astro' renders through this repo's own shell and is ours to get right.
  # 'sphinx' and 'native-skinned' emit their own HTML, links and anchors.
  case "$renderer" in
    sphinx | native-skinned) ;;
    *) continue ;;
  esac
  for version in "${versions[@]}"; do
    vendored_args+=(--vendored "$locale/$slug/$version")
  done
done < <(list_ports)

printf '\n'
if ! node "$(dirname "$0")/check-links.mjs" "$out_dir" --all "${vendored_args[@]}"; then
  printf 'build-site: broken internal links from pages this repo generates (see the list above)\n' >&2
  exit 1
fi
