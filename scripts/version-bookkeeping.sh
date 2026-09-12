# shellcheck shell=bash
# The caller assigns what this reads, so a standalone check cannot see it.
# shellcheck disable=SC2154
#
# Version bookkeeping for scripts/build-site.sh.
#
# Sourced rather than run: it writes the manifest this build was trimmed to and
# defines the four questions the build asks of it. A file rather than a stretch
# of build-site.sh because site/test/versions.test.ts drives these functions,
# and it used to reconstruct them by splitting the script between two comment
# banners — a split that renaming either banner would have quietly emptied.
#
# Expects scratch, script_dir, site_dir, locale and versions_arg to be set.

manifest="$scratch/versions.json"
node "$script_dir/gen-versions.mjs" --out "$manifest"

# Defaults must describe this build before any links or canonicals are rendered.
LIBTMUX_DOCS_MANIFEST="$manifest" LIBTMUX_DOCS_BUILD_VERSIONS="$versions_arg" LIBTMUX_DOCS_SITE_DIR="$site_dir" \
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs"
  const { selectBuildVersions } = await import(`file://${process.env.LIBTMUX_DOCS_SITE_DIR}/src/lib/versions.ts`)
  const file = process.env.LIBTMUX_DOCS_MANIFEST
  const candidate = JSON.parse(readFileSync(file, "utf8"))
  const selected = process.env.LIBTMUX_DOCS_BUILD_VERSIONS.split(",")
  writeFileSync(file, JSON.stringify(selectBuildVersions(candidate, selected), null, 2) + "\n")
'

# The manifest is the one this build trimmed, so a missing default means the
# selection kept none of that port's versions. Naming a slug this build never
# produced would mislabel which page is canonical, so it fails instead.
default_version_for() {
  LIBTMUX_DOCS_MANIFEST="$manifest" LIBTMUX_DOCS_PORT="$1" node -e '
    const fs = require("node:fs")
    const m = JSON.parse(fs.readFileSync(process.env.LIBTMUX_DOCS_MANIFEST, "utf8"))
    const port = process.env.LIBTMUX_DOCS_PORT
    const slug = m.defaultVersion[port]
    if (!slug) {
      process.stderr.write(`no default version for ${port}: this build kept none of its versions\n`)
      process.exit(1)
    }
    process.stdout.write(slug)
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

# Port trees are rendered in the default locale only, so every locale links
# across to them rather than expecting a copy beneath itself.
LIBTMUX_DOCS_PORT_ROOT="${LIBTMUX_DOCS_LOCALES_ROOT:-}/$locale"
export LIBTMUX_DOCS_PORT_ROOT

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
