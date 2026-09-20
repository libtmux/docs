# Proposed title

Add first-class Ruby and Lua documentation

# Proposed body

## Summary

- **Add Ruby and Lua port support**: Register both ports with package metadata, installation choices, source-backed quickstarts, language filtering, highlighting, version routing, and cross-port equivalents.
- **Unify API references**: Render Ruby's core, async, MCP, and workspace gems from public inventory, YARD, and RBS evidence, and render Lua core plus luv and Neovim runtime declarations from LuaLS output.
- **Document actual product status**: Provide working Ruby MCP and workspace guidance while giving Lua MCP and workspace explicit unavailable pages that do not advertise scaffolds.
- **Bind documentation to source**: Assemble models, staged guides, examples, source links, machine exports, canonical URLs, robots policy, and version manifests from the selected source revision.
- **Prepare isolated publication**: Add source-bound trunk, branch, preview, prerelease, release, alias, manifest, and preview-cleanup paths without letting a port delete another port's tree.

## Changes by area

### Port and content model

- **Ruby and Lua metadata**: Extend the authoritative port registry, package registry generation, version discovery, install matrix, quickstarts, prompts, and equivalent-link model.
- **Source-owned guides**: Stage selected guides and tested example regions from the same checkout used for API extraction, rewrite internal links, and preserve source provenance.
- **Product pages**: Document Ruby MCP configuration, tool contracts, and workspace validate/plan/load behavior; state that Lua MCP and workspace products are unavailable.

### Unified reference

- **Native adapters**: Add Ruby and Lua model adapters while retaining the shared Astro reference shell and API schema.
- **Coverage controls**: Validate public inventory coverage, module ownership, source links, cross-references, type-link residue, navigation placement, and Markdown twins.
- **Exports**: Include Ruby and Lua in searchable HTML, Pagefind, JSON indexes, inventories, prompt exports, and source-linked Markdown.

### Versioning and publication

- **Revision identity**: Require the requested source ref to resolve to the checked-out commit and carry that identity through generated models and pages.
- **Release policy**: Keep prereleases out of stable defaults, protect immutable release prefixes, and distinguish trunk, maintenance branch, pull-request, tag, and alias builds.
- **Scoped deployment**: Publish port-owned version trees and manifests through the reusable workflow, merge them in the shell job, and remove only the closed preview's prefix.

## Integrated versions

| Port | Source release | Packages |
| --- | --- | --- |
| Ruby | `v0.1.0.alpha.1` | `libtmux`, `libtmux-async`, `libtmux-mcp`, and `libtmux-workspace` at `0.1.0.alpha.1` |
| Lua | `v0.1.0alpha1` | `libtmux` at `0.1.0alpha1-1`; MCP and workspace unavailable |

## Design decisions

- **Owned Astro shell**: Ruby and Lua extend the existing layouts, components, integrations, and API model; this change does not introduce another documentation framework.
- **Evidence before parity**: Shared concepts link only where source-backed semantics exist. Lua status pages remain explicit instead of translating Ruby product capabilities.
- **Port-owned trees**: Normal production publication stays in each port repository so its toolchain and prefix permissions remain isolated from the shared shell.
- **TypeScript 6**: The workspace keeps its existing TypeScript catalog constraint.

## Verification

Run the source-only medium loop:

```console
$ pnpm test:medium
```

Run type checks, the Astro build, development server checks, and browser coverage:

```console
$ pnpm test
```

Run the complete publication audit after all configured port checkouts have current generated models:

```console
$ pnpm test:publication
```

## Test plan

- [x] Ruby and Lua native exporters are deterministic and reject source or inventory drift.
- [x] Installed-package examples run against owned tmux sockets.
- [x] Revision-bound assembly checks generated pages, internal links, Pagefind, Markdown twins, machine exports, canonicals, robots directives, and sitemap membership.
- [x] Browser checks cover desktop, tablet, and phone widths in light and dark themes, including installs, guides, APIs, Ruby products, Lua status pages, navigation, tables, fonts, and visual baselines.
- [ ] The uninterrupted publication audit is blocked by stale pre-existing generated models for the other ports on the fully provisioned workstation; Ruby and Lua freshness passes, and the assembly/publication phases pass when run after that gate.
- [ ] Production navigation, search, default routing, manifest aggregation, and preview cleanup require the repository environments and AWS policy described below.

## Setup required

1. Make the site revision pinned by the Ruby and Lua caller workflows publicly resolvable before publishing either port branch.
2. Configure repository or organization secrets for the bucket, distribution, production role, preview role, and cleanup role.
3. Configure `docs`, `docs-preview`, and `docs-preview-cleanup` environments with ref restrictions and matching OIDC trust policies.
4. Limit each port role to its own version and manifest prefixes, publish both default trees, then run the coordinated shell publication.
5. Close a real preview and verify its exact prefix is removed without changing trunk, release, alias, other-port, or shared search content.

## Companion changes

- `libtmux/libtmux-ruby` branch `docs-site` supplies the four-gem exporter, checked examples, and revision-bound publisher caller.
- `libtmux/libtmux-lua` branch `docs-site` supplies the LuaLS exporter, checked examples, and revision-bound publisher caller.
