# Ruby and Lua documentation implementation plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement the tasks and verification gates.

**Goal:** Give Ruby and Lua first-class libtmux.org documentation, including
installation widgets, tested examples, unified API references, accurate MCP
and workspace pages, and documentation builds for their `docs-site` PRs.

**Architecture:** Keep the owned Astro shell and shared API model. Each port
exports its native documentation data from a selected source revision; this
repository normalizes that data, renders pages, and supplies the reusable
publisher. Product availability controls widgets, navigation, and exports.

**Tech stack:** Astro, TypeScript 6, pnpm, the existing API model, Ruby
YARD/RBS/public API inventory, LuaLS, GitHub Actions, S3, and CloudFront.

**Spec:** The scope, route matrix, and acceptance gates in this document.
This is an investigation and implementation plan. The integration and the
three proposed PRs are not implemented by this planning change.

## Global constraints

- Keep TypeScript on the workspace's 6.x catalog entry; do not bump it to 7.
- Use owned Astro components and the existing API model and route helpers.
- Keep port identity and version decisions in `ports.ts` and `versions.ts`.
- Use `ruby` and `lua` as the proposed public port slugs.
- Keep port changes on `docs-site` in sibling `libtmux-ruby-docs` and
  `libtmux-lua-docs` worktrees. Authenticate trunk and existing worktree state
  again before creating them; neither exists at this investigation's snapshot.
- Follow the repository boundary in [AGENTS.md](../../../AGENTS.md): prepare
  port commits and review material locally, then hand publication to the
  maintainer. This plan does not push branches or open PRs.
- Run examples against owned tmux sockets and preserve existing user state.
- Scope upload and cleanup to one job's exact port/version prefix.
- Apply [CONTRIBUTING.md](../../../CONTRIBUTING.md) and
  [WRITING.md](../../../WRITING.md), including whole-command test budgets:
  inner under 2 seconds, medium under 10 seconds, outer under 60 seconds.
  The separate publication audit includes full assembly and browser coverage.

## Verified starting point

Evidence was refreshed on 2026-09-20. Local clean trunks matched authenticated
public GitHub heads. Source links below pin the inspected revisions.

| Repository | Inspected source | Docs branch state |
| --- | --- | --- |
| Site | [Current docs source](https://github.com/libtmux/docs/tree/47b79362c86af6018cccfb1a18bdeb0647e9b0fd) | Clean `main`; registers eight existing ports, neither Ruby nor Lua |
| Ruby | [Ruby alpha source](https://github.com/libtmux/libtmux-ruby/tree/v0.1.0.alpha.1) | Clean `master`; no sibling docs worktree, `docs-site` branch, or docs PR |
| Lua | [Lua alpha source](https://github.com/libtmux/libtmux-lua/tree/v0.1.0alpha1) | Clean `master`; no sibling docs worktree, `docs-site` branch, or docs PR |

### Packages and capabilities

| Package | Published version | Documentation scope |
| --- | --- | --- |
| [Ruby core](https://rubygems.org/gems/libtmux) | `0.1.0.alpha.1` | Blocking API, snapshots, queries, control connections; require `libtmux` |
| [Ruby Async](https://rubygems.org/gems/libtmux-async) | `0.1.0.alpha.1` | Async tasks, bounded streams, cancellation; require `libtmux/async` |
| [Ruby MCP](https://rubygems.org/gems/libtmux-mcp) | `0.1.0.alpha.1` | Executable and embedding API; require `libtmux/mcp` |
| [Ruby workspace](https://rubygems.org/gems/libtmux-workspace) | `0.1.0.alpha.1` | YAML/JSON plans and `validate`, `plan`, `load`; require `libtmux/workspace` |
| [Lua core](https://luarocks.org/modules/tony/libtmux) | `0.1.0alpha1-1` | Core API and luv/Neovim runtime adapters |
| Lua MCP and workspace | Unpublished | Scaffolds; no usable server, loader CLI, or product API to advertise |

Registry HTTP APIs confirmed all four Ruby versions. Ruby's GitHub
`releases/latest` endpoint returns 404 because its only release is a
prerelease. LuaRocks confirms the core rock and Lua `>= 5.1, < 5.6`.
The [Lua README](https://github.com/libtmux/libtmux-lua/blob/v0.1.0alpha1/README.md)
explicitly identifies the companion scaffolds and unverified macOS coverage.

Ruby requires Ruby 3.3 or newer. Standalone Lua live operations need luv;
Neovim uses its own libuv adapter. Package installation, local queries, and
live tmux operations have different prerequisites and should say so.

Neither release spelling fits either existing site version grammar. A live
import of `releaseTag` returns `null` for both `v0.1.0.alpha.1` and
`v0.1.0alpha1` under both `semver` and `pep440`. Git tags, gem versions, and
rock revisions must retain their distinct spellings.

### Exporter evidence

Ruby already has a useful documentation pipeline:

- [Public API inventory](https://github.com/libtmux/libtmux-ruby/blob/v0.1.0.alpha.1/scripts/types)
  records public ownership, methods, source locations, visibility, and RBS
  signatures, including generated and inherited methods.
- [Behavior contracts](https://github.com/libtmux/libtmux-ruby/blob/v0.1.0.alpha.1/docs/reference/contracts.json)
  associate public methods with behavioral documentation.
- [Documentation checker](https://github.com/libtmux/libtmux-ruby/blob/v0.1.0.alpha.1/scripts/docs)
  renders Markdown and YARD and validates links and fragments.
- [Example manifest](https://github.com/libtmux/libtmux-ruby/blob/v0.1.0.alpha.1/examples/manifest.json)
  connects documentation to executable source programs.

The bounded checks passed: inventory validation covered 693 methods across
71 namespaces in 1.24 seconds; example freshness covered ten programs in
0.50 seconds; documentation rendering checked 153 pages in 6.97 seconds.
These are investigation checks, not a new run of Ruby's full runtime matrix.

An in-memory YARD probe directly resolved only 319 of the inventory's 693
method IDs. Reuse the inventory as the public surface authority and enrich
it with YARD, RBS, and behavior prose. Raw YARD HTML includes private and
protected declarations for link resolution and is not the public API filter.

Installed LuaLS 3.19.1 produced `doc.json` and `doc.md` in 5.92 seconds.
The JSON contains 102 top-level entries, including 98 types, with generics,
tuple returns, field signatures, and source locations. However, it omits
query functions and the luv/Neovim module entrypoints, includes test types,
and includes configuration containing an absolute workspace path.
[LuaLS documentation export](https://luals.github.io/wiki/export-docs/)
supports native JSON. A second probe exported an isolated copy of `lua/`
after adding three module class annotations. It completed in 0.70 seconds
and included all 13 query functions plus `NULL`, `luv.run`, and `nvim.start`,
without test types. This establishes a native annotation approach; a custom
export hook or separate LDoc toolchain is unnecessary. Private helper and
configuration filtering still belongs in the wrapper. Tracked source stayed
unchanged during both probes.

### What the precedent PRs establish

[Rust's prose publishing PR](https://github.com/libtmux/libtmux-rs/pull/24)
and [C++'s reference publishing PR](https://github.com/libtmux/libtmux-cxx/pull/12)
are merged. Their workflows demonstrate pinned shared tooling, artifact
upload, and the reusable publisher. They build `latest`, skip native
reference rebuilds and shared Pagefind, and do not implement release
archives or PR previews. Do not copy a `docs-site` push trigger that deploys
over `latest`.

The current site has further integration gaps:

| Area | Source and observed behavior | Required result |
| --- | --- | --- |
| Port identity | `site/src/lib/ports.ts`, `packages/api-model/src/model.ts` omit both ports | Complete identities, registries, languages, and models |
| Installation | `scripts/gen-registry.mjs` lacks both probes; `registryFor` throws on missing entries | Generated package state and usable gem/Bundler/LuaRocks instructions |
| Versioning | `versions.ts` has only SemVer/PEP 440; `gen-versions.mjs` ignores checkout overrides | Correct alpha classification and source-aware version identity |
| API extraction | `project.ts` rejects either new port; `gen-api-model.mjs` has no inputs | Native adapters feeding unified reference pages |
| Code fences | `remark-port-code.mjs` lacks Ruby/Lua ownership | Source excerpts, filtering, tabs, and highlighting use the right port |
| Products | `Overview.astro` treats every port as an MCP server; `sidebar.ts` adds Tools unconditionally | Lua status pages without false install/tool/API links |
| Build identity | `scripts/version-bookkeeping.sh` rejects tags, branches, and PRs | One validated source checkout for each named version build |
| Published versions | Publisher writes `manifest/<port>.json`; switchers read `/en/versions.json` | Successful publication updates visible versions and default selection |
| Search/deployment | Shared indexes and edge defaults are separate from port uploads | Search, sitemap, redirects, and robots agree with published content |

Direct requests to the proposed Ruby and Lua production homes returned HTTP
403. They do not prove a functioning docs tree or distinguish a missing
object from access policy. Production rendering remains unverified.

## Proposed PRs and dependency order

| PR | Branch/worktree | Reviewable deliverable |
| --- | --- | --- |
| Site: Ruby and Lua documentation support | This repository's integration branch | Port/product metadata, native model adapters, widgets/content, source-bound builds, and publication integration |
| Ruby: Export and publish versioned documentation | `docs-site` in `libtmux-ruby-docs` | Deterministic export for four gems, checked source examples, docs CI and scoped publisher caller |
| Lua: Export and publish core documentation | `docs-site` in `libtmux-lua-docs` | Complete public module/type export, checked examples, docs CI and scoped publisher caller |

Start by agreeing the native artifact contract and site capability metadata.
Ruby and Lua exporters can then proceed independently while the site consumes
fixtures from each. Verify all three locally together. Make the site's
reusable workflow revision publicly available before pinning both port
callers to the same full SHA for checkout and workflow use. Port publishing
and PR submission remain maintainer handoffs under the repository policy.

The following checklist records implementation state as of 2026-09-20.
Checked items have current local evidence in the final evidence ledger below;
publication-dependent items remain open.

## Task 1: Define package, capability, and version metadata

**Files:** `site/src/lib/ports.ts`, `site/src/lib/versions.ts`,
`scripts/gen-registry.mjs`, `scripts/gen-versions.mjs`,
`site/src/lib/registry.ts`, `site/src/data/registry.json`,
`site/src/components/icons/RegistryIcon.astro`, `site/test/versions.test.ts`,
and `site/test/prompts.test.ts`.

**Interfaces:** Keep `PORTS` authoritative. Add `ruby` and `lua` with
`versionedDocs: true`, `renderer: 'astro'`, and no independently published
native `api/` tree. Keep the core registry link and add package-specific
metadata for Ruby's companions. Product status must distinguish available
alpha software, an unpublished scaffold, and absence; package publication
and API maturity are separate facts.

- [x] Register the requested checkout/worktree pairs in `ports.ts` and use
  existing checkout override conventions for CI.
- [x] Add RubyGems and LuaRocks registry icons and probes. Read each Ruby gem
  independently; sharing a release today does not guarantee future lockstep.
  Keep offline snapshots; transport/auth failures must not mean unpublished.
- [x] Add Ruby tag parsing and Lua tag parsing to `versions.ts`. Normalize
  LuaRocks rock revisions separately: `0.1.0alpha1-1` installs the rock,
  while `v0.1.0alpha1` identifies its source. Avoid relabeling these as SemVer.
- [x] Exercise alpha.2 versus alpha.10, alpha versus stable, invalid tags,
  and different rock revisions. Preserve all existing grammar tests.
- [x] Keep `latest` as the initial default for these prerelease-only ports.
  Expose `next` or immutable release URLs only after building their exact
  source; do not synthesize a `stable` release.
- [x] Replace all-port MCP assumptions with capability checks. Set Ruby's
  workspace command to `libtmux-workspace load`; Lua exposes status only.

**Gate:** Registry snapshots cover every enabled package, both release tags
are recognized as prereleases, and every generated install/prompt resolves
all version placeholders. An unconfigured product cannot produce a launcher.

## Task 2: Export Ruby's four public gem surfaces

**Files in the Ruby docs worktree:** reuse `scripts/types`, `scripts/docs`,
`scripts/examples`, `docs/reference/contracts.json`, `examples/manifest.json`,
the gem READMEs and gemspecs. Add `scripts/export-docs` as the native export
entrypoint and `.github/workflows/docs.yml` for the caller in Task 6.

**Interface:** `scripts/export-docs` writes an ignored
`docs/_build/api.json` artifact with schema version, source SHA, exporter
version, each package's version/require path, and its public inventory,
signatures, source coordinates, documentation, and example references.
Bundle selected source guides and their relative assets alongside it.
The site adapter owns conversion to `ApiModel`; do not hand-maintain a
second inventory of Ruby method names.

- [x] Create the clean `docs-site` worktree from reauthenticated Ruby trunk.
- [x] Reuse `PublicAPI#records`; preserve public owner separately from the
  implementation's source owner. Enrich inherited/generated methods and
  constructors rather than discarding records missing a direct YARD object.
- [x] Preserve instance versus class methods, predicates, bang/setter names,
  operators, overloads, positional/keyword/block arguments, return types,
  raised errors, and linked behavior contracts. Include public RBS aliases
  and generics that have no runtime method record, such as
  `LibTmux::Async::scope_diagnostics` in public return contracts.
- [x] Attribute all four gems. Render core and Async in the core reference
  with separate package/navigation groups; route MCP and workspace symbols
  to their existing product reference sections. No new Async product axis
  is needed to make its package and API discoverable.
- [x] Reuse existing source-backed examples and their collected regions.
  Add or adjust regions only where the site's selected excerpts need them.
- [x] Extend existing docs checks to compare export membership with the
  inventory and to reject internal leakage, missing contracts, broken source
  links, duplicate IDs, nondeterminism, and machine-specific paths.
- [x] Prepare each gem's `documentation_uri` for its canonical site page.
  Apply registry metadata on a subsequent authorized gem release; editing a
  gemspec does not update already published gems.

**Gate:** Every current public inventory method has a documented site
destination, including Async inheritance and generated readers. Existing
Ruby type, example, and standalone docs checks continue to pass.

## Task 3: Export Lua modules and annotated contracts

**Files in the Lua docs worktree:** `lua/libtmux/init.lua`,
`lua/libtmux/query.lua`, `lua/libtmux/runtime/luv.lua`,
`lua/libtmux/runtime/nvim.lua`, the LuaLS configuration and annotated
contract sources, existing `docs/` and `examples/`, plus new
`scripts/export-docs` and `.github/workflows/docs.yml`.

**Interface:** The native export writes ignored `docs/_build/api.json`
with the same provenance envelope as Ruby and a LuaLS-derived declaration
payload. Include the public modules returned by `require`, not merely global
types. Bundle the source README, selected guides, and examples alongside it.
Raw LuaLS configuration and dependency/test declarations stay out.

- [x] Create the clean `docs-site` worktree from reauthenticated Lua trunk.
- [x] Reuse the pinned LuaLS toolchain. Export documentation without starting
  tmux, a Neovim UI, or an MCP scaffold.
- [x] Inject `---@class libtmux.query`, `---@class libtmux.runtime.luv`, and
  `---@class libtmux.runtime.nvim` into an isolated copy immediately before
  the respective `local M = {}` declarations. Export only that copied `lua/`
  tree so immutable release sources stay byte-for-byte unchanged.
- [x] Preserve `Request<T>`, `Selection<T>`, entity/record types, aliases,
  union and optional types, callback signatures, and `value, err` returns.
  Render colon receiver syntax accurately. Convert LuaLS's zero-based line
  positions to one-based source links.
- [x] Filter by public contracts and source ownership. Do not discard every
  `_internal` file: several declarations there are public signature types.
  Exclude test classes, `package.*` globals, tool configuration, dependency
  definitions, `_driver`/`_result` helpers, and absolute paths. Prefix the
  source-root-relative filenames with `lua/` for repository links.
- [x] Add export coverage checks for module functions as well as Server,
  Entity, Runtime, Request, Selection, and Snapshot contracts. Preserve
  existing LuaLS/type checking and executable example checks. Extend the
  current `scripts/check.py docs` gate beyond whitespace and local file
  existence to check rendered anchors and the exported public surface.

**Gate:** The exported model contains the known missing query/runtime
entrypoints, useful type contracts, valid source links, and no test/config
leakage. Lua MCP/workspace scaffolds do not become public API pages.

## Task 4: Render unified API references and cross-port links

**Files:** Add `packages/api-model/src/languages/ruby.ts` and `lua.ts` with
focused native-artifact fixtures/tests. Extend `model.ts`, `project.ts`,
`products.ts`, `product-exports.ts`, `nav-config.ts`, `concepts.ts`,
`resolver.ts`, and `link.ts` only where the new formats require it. Wire
`scripts/gen-api-model.mjs`, `site/src/lib/api-models.ts`, the model/nav
sidecars in `site/src/data/api/`, and existing reference components.

**Interfaces:** Both adapters return the existing `ApiModel`/`ApiSymbol`
shape. Retain package versions in `sources` and source provenance per
symbol. Ruby core and Async remain distinguishable even though both use the
core product route. Record missing equivalences as absences with reasons.

- [x] Normalize both native artifacts and reject missing/stale artifacts
  against their recorded source SHA. A missing native exporter is a build
  failure, not a model with zero symbols.
- [x] Add models and nav sidecars to the site's static imports and port
  names. Review hardcoded eight-port lists in model, resolver, coverage,
  guarantees, federation, and product tests so the new ports are exercised.
- [x] Preserve Ruby `::`, `#`, `.`, `?`, `!`, `=` and Lua module/colon
  identities through lookup and unique slug allocation. Test class/instance
  methods that share a basename and mixed-case collisions.
- [x] Add source-verified equivalents for the shared topology, snapshot,
  selection, creation, send/capture, and lifecycle tasks. Do not map Ruby
  snapshots or Lua Request completion to another port by name alone.
- [x] Render doc tags, parameter/return/error sections, overloads, examples,
  internal supporting types, and public ownership in existing components.
- [x] Extend API mention recognition and filename exclusions for `.rb` and
  `.lua`; regenerate navigation and "Discussed in" backlinks.

**Gate:** Representative core/Async/MCP/workspace Ruby references and Lua
module/type references render in HTML and Markdown. Every advertised API
link and equivalent resolves to the correct product and source revision.

## Task 5: Add installation, examples, and product documentation

**Files:** `site/src/lib/{ports,registry,quickstarts,install-matrix,highlight,
prompts,prompt-highlight,page-port-links,sidebar,llms}.ts`,
`site/src/plugins/{remark-port-code,rehype-code-tabs}.mjs`,
`site/src/plugins/rehype-api-links.ts`, `scripts/gen-mentions.mjs`,
`scripts/gen-example-sources.mjs`, a new `scripts/stage-port-docs.mjs` for
native Markdown intake, `PackageInstall.astro`, `McpInstall.astro`,
`AgentPrompt.astro`, `mcp/Overview.astro`, `DocsLayout.astro`, and source pages
under `site/src/content/docs/`. Extend `content.config.ts`,
`lib/docs-paths.ts`, `components/docs/DocPage.astro`, and the Markdown-twin
route to consume staged route and source-provenance metadata.

### Expected reader routes

Paths below are relative to `/en/<port>/<version>/`.

| Surface | Ruby | Lua |
| --- | --- | --- |
| Home and package picker | Core gem and tested quickstart; companion links | Core rock, runtime choice, tested quickstart |
| `guides/`, `concepts/`, `examples/` | Core tasks plus Async ownership/cancellation | Requests, tuple errors, dense selections, luv and Neovim |
| `reference/` | Core and separately identified Async package APIs | Public modules, entities, Requests and type contracts |
| `mcp/` | Installation, configuration, guides, topics, examples | Explicit unpublished-scaffold status |
| `mcp/tools/`, `mcp/reference/` | Actual wire catalog/protocol and Ruby embedding API | No advertised tool catalog or API route |
| `workspace/` | Install, validate, plan, load and creation-only limits | Explicit unpublished-scaffold status |
| `workspace/reference/` | Workspace library API, plus internals where useful | No invented loader or builder reference |
| `api/` | Redirect to unified reference | Redirect to unified reference |

- [x] Extend `PackageInstall` metadata with Ruby gem and Bundler choices and
  LuaRocks instructions. Include Ruby and Lua highlighting. Keep Gemfile
  fragments separate from shell commands and ensure copied shell text has no
  prompt prefix. Companion pages install their own package.
- [x] For the current Ruby release, verify the generated equivalent of
  `gem install --version 0.1.0.alpha.1 libtmux` and the matching explicit
  prerelease Gemfile entry. Repeat for companions. For Lua, verify
  `luarocks --local install libtmux 0.1.0alpha1-1`, module search-path setup,
  and the separate luv dependency for standalone live examples.
- [x] Add Ruby/Lua to fence ownership, checkout resolution, tab labels,
  highlighters, prose linking, example cache, and mention labels. Test both
  the shared page and each filtered port build; a Lua block must not leak
  into a Ruby page because its language is unknown.
- [x] Source quickstarts from executable examples. Cover session/window/pane
  creation, queries, send/capture, close/cleanup, and each port's completion
  and error semantics. Show a Lua Neovim example separately from standalone
  luv; add Ruby Async examples using an application-owned Async task.
- [x] Reuse Lua's existing `examples/native_query.lua` and
  `examples/snapshot.lua` and Ruby's `examples/manifest.json`. Add collection
  coverage for any new creation/send/capture example: Lua's current example
  pair does not by itself verify that larger quickstart.
- [x] Add core guide coverage and package-specific pages. Audit shared
  guides, comparison tables, parity pages, and examples, including workspace
  file loading. Where a feature is absent, state it and link a clearly
  identified alternative rather than translate unsupported APIs.
- [x] Stage selected source-owned Ruby guides and gem READMEs, and Lua's
  existing runtime/query/topology/control/reference guides, from the same
  source checkout as the API. Add title/port/product metadata, preserve
  source attribution and tested regions, rewrite relative links/assets, and
  remove duplicate body H1s. Keep shared task prose in the site's existing
  pages; define one owner for each resulting route to prevent collisions.
  Currently `docsPath` strips the port prefix only for product pages and
  `DocPage` attributes prose to the docs repository. Extend both behaviors
  explicitly for staged core guides and mirror them in Markdown exports.
  Stage into an ignored directory cleared for each build so a removed branch
  guide cannot survive from the previous build. Check source-guide headings
  and every rewritten destination. Historical builds must not silently use
  a newer guide from a different revision.
- [x] Have `gen-mentions.mjs` consume the staged route/provenance metadata and
  selected version. Its current port-guide URL rewrite hardcodes `latest`;
  branch and release backlinks must stay in the version being rendered.
- [x] Audit every agent-prompt topic, including workspace freeze/restore and
  live waiting. Gate unsupported topics or add explicit capability text.
  Generated prompt pages, text downloads, and widgets must agree.
- [x] Add the Ruby MCP `ServerSpec` using `libtmux-mcp`, explicit `--socket`
  or `--socket-name`, and the actual policy settings. `--endpoint` names an
  alias; it does not select the socket. Keep install and launch steps distinct.
- [x] Extend `scripts/gen-mcp-protocol.mjs` and `gen-mcp-tools.mjs` for Ruby.
  Capture initialize, tool schemas, resources, templates, and prompts against
  an owned endpoint, querying optional catalogs only when advertised.
  Record absent capabilities explicitly: Ruby currently has no prompt
  catalog and resources do not support subscriptions or change notices.
  Show default capabilities/snapshot tools separately from opt-in
  observation (`tmux_capture`, `tmux_wait`) and mutation/execution tools.
  Preserve protocol output where it defines the client contract.
- [x] Explain Ruby tracked operations' tmux 3.3+/native identity requirements
  and enrolled zsh requirements for authored runs. Document workspace
  `validate`, offline `plan`, and live `load`/`plan --live` prerequisites.
  Do not imply reconciliation or a universal `tmuxp` CLI contract.
- [x] Make Lua product status work through the entire route pipeline:
  `serverSpec`, generators, overview counts, sidebar, page switchers,
  reference routes, prompts, machine-readable exports, and install widgets.
  Keep useful MCP/workspace landing pages; omit runnable instructions and
  links to nonexistent product APIs. Remove "all ports ship a server" and
  literal eight-port denominator assumptions.
- [x] Check icons, desktop/mobile tabs, keyboard controls, clipboard text,
  persisted selection, no-JavaScript fallback, and dark mode. Use existing
  widgets and focused tests rather than introducing another picker.

**Gate:** Readers can install and run both core examples, reach all four
Ruby gem surfaces, and understand Lua's actual product availability. No
widget, prompt, sidebar, or export invents a Lua server or workspace loader.

## Task 6: Bind branch documentation to its source and publisher

**Files:** `scripts/build-site.sh`, `scripts/version-bookkeeping.sh`,
`scripts/gen-versions.mjs`, `.github/workflows/reusable-deploy.yml`,
existing version-switcher and injected-shell code, publication/cleanup
scripts, `docs/ci.md`, `infra/`, and each port's new docs caller workflow.

**Interface:** Add an explicit single-port build mode taking port, version
slug/kind, source ref, expected source SHA, checkout, and default identity.
Validate ref/SHA before rendering. Keep ordinary assembly's refusal to
fabricate historical versions. The artifact root contains one port/version
tree, including prose, references, Markdown, and machine-readable exports.

- [x] Honor `LIBTMUX_DOCS_CHECKOUT_RUBY` and `LIBTMUX_DOCS_CHECKOUT_LUA`
  consistently in version discovery, extraction, and source excerpts.
  Regenerate selected API/nav data, stage its source guides, then regenerate
  example-source data and mentions/backlinks before Astro.
  A checkout override alone does not refresh committed models.
- [x] Separate source revision from pinned generator revision so existing
  release tags, which predate docs tooling, can be documented truthfully.
  For Lua tags predating module annotations, generate the annotation input
  in an isolated copy and retain original source coordinates; verify the
  exported surface against that release. Bind the build cache to both
  revisions and selected artifact content.
- [x] Add verified source-SHA handling to `gen-api-model.mjs` source-link
  selection. Its current `publicRevision` maps branch HEAD to a merge base
  on public trunk. A published PR source must link to its verified selected
  revision, while unpublished local changes must not acquire fictitious
  public source links.
- [x] Derive rendered robots, canonical URLs, manifest identity, and
  publisher `is-default` from one input. Reject mismatches and source-SHA
  disagreement before upload.
- [x] Build default-branch pushes as `latest`; build the docs PR as `pr-N`
  with `kind: pr` and `is-default: false`. Give standalone docs branches a
  distinct branch slug when needed. A branch push must not overwrite trunk.
- [x] Build tags and supported maintenance branches from their exact source.
  Add prerelease alias handling only when its target artifact exists. Do not
  advertise every discovered Git ref as already published documentation.
  Guard immutable tag uploads with artifact digest/provenance checks: an
  identical rerun is a no-op; different bytes fail before upload. The current
  reusable publisher's `sync --delete` does not enforce write-once tags.
- [x] Use unprivileged build/artifact checks for all PRs. Publish only trusted
  same-repository previews with scoped credentials; never run a fork's code
  with production credentials. Serialize each publication/cleanup pair by
  its owned prefix.
- [ ] Pin the docs checkout and reusable publisher to the identical public
  full SHA. Use frozen port documentation dependencies. Upload artifact
  contents rather than a wrapper directory.
- [x] Validate `path-prefix` against the supplied port/version, including
  Ruby/Lua and rejecting bare port roots, traversal, and cross-port writes.
  Caller prefixes such as `ruby/pr-N` become `en/ruby/pr-N` in the publisher.
  Preview cleanup deletes only that preview. PR jobs do not write production
  manifest fragments; bake the current preview into its own version picker.
- [x] Connect published per-port manifest fragments to both version switcher
  implementations with seed fallback. Only successful publications become
  selectable; production switchers and defaults exclude previews.
- [ ] Verify or provision GitHub docs/preview environments, deployment ref
  restrictions, OIDC trust, pass-through secrets, and IAM ownership for the
  exact locale/port prefixes and manifest key. Only release/LuaRocks
  environments were visible during investigation; organization secrets and
  live AWS policy were not verified.
- [ ] Include successful default Ruby/Lua trees in shared Pagefind and sitemap
  assembly. Coordinate the edge default pointer and shell assets. Port
  workflows must not claim shared search is current merely because upload
  succeeded.

**Gate:** A source-change fixture visibly differs between trunk and preview;
tag content matches its tag. Preview robots are `noindex, nofollow`, all
assets/links resolve, and preview publication/cleanup preserves trunk,
release archives, other ports, search defaults, and default redirects.

## Task 7: Verification and maintainer handoff

Extend existing tests for versions, installs, prompts, code tabs, examples,
API coverage/guarantees, product docs, switcher targets, publication prefixes,
search, and machine-readable exports. Add new tests only for native export
contracts and source identity that existing suites cannot express.

- [x] Check deterministic exports and native inventory parity in each port.
  Run collected examples from installed artifacts on owned sockets. Preserve
  Lua's runtime/platform caveats; Linux checks do not prove macOS support.
- [x] Check source-only rendering and generated-data freshness offline.
  Registry calls, tool installation, browser launches, and production builds
  stay outside inner/medium loops.
- [x] Run the existing development loops with elapsed wall-clock evidence.
  Fix any budget regression before adding coverage; do not raise budgets.
- [ ] Run complete assembly and publication checks with both new checkouts
  present. A skip for either new port fails this integration's acceptance.
- [x] Browser-check home/install tabs, one core guide, API pages, Ruby Async,
  Ruby MCP configuration/tools, Ruby workspace instructions, and both Lua
  product status pages at 1440, 768, and 390 pixels in light/dark modes.
- [x] Verify Pagefind results, Markdown twins, docs/API indexes, inventories,
  prompt exports, version/page switchers, source permalinks, breadcrumbs,
  canonical URLs, robots, sitemap inclusion, and preview prefix isolation.
- [x] Refresh `notes/adding-a-port.md` to match the implemented contract: it
  currently names obsolete fields such as `referenceMode` and `install`.
  Update contributor commands and docs CI guidance in their owning files.
- [ ] Hand stale repository descriptions and missing docs homepages to the
  maintainer for a metadata update once the canonical URLs work. Do not use
  the old scaffold descriptions to infer current package capabilities.
- [ ] Prepare three PR descriptions with resulting behavior, package/source
  versions, checks and skips, and exact deployment prerequisites. Port PRs
  target their public repositories from `docs-site`; hand them to the
  maintainer under the current repository publication rule.
- [ ] After authorized publication, verify the real Ruby/Lua pages, preview
  cleanup, version manifests, search, and redirects. Local green checks and
  successful object upload do not establish production readiness.

Run the medium loop from this repository:

```console
$ pnpm test:medium
```

Run the outer loop before implementation commits:

```console
$ pnpm test
```

Run the full publication audit with its documented prerequisites:

```console
$ pnpm test:publication
```

## Implementation evidence (2026-09-20)

### Source and exporter identity

- Site integration commit `d28aa869613f41506c2c8bc6feea789247436fc5`
  introduced the Ruby/Lua models, content, widgets, source-bound build path,
  publication guards, and caller workflow contract. The current follow-up
  closes module navigation and browser-audit gaps.
- Ruby model source is the public `v0.1.0.alpha.1` commit
  `e3815d2b35a6c663f20769231e1d22b565f87038`. The native exporter commits are
  `c498e4140b3e71fed28415a176d3c91479d62ba5` and
  `6bf300b` on the local `docs-site` worktree.
- Lua model source is the public `v0.1.0alpha1` commit
  `ec6994889860b99731fc95a70d602381f6af4aee`. The native exporter commits are
  `9fe976d`, `1cbfdc12b0126006c90b7cb36c027f8f098ad461`, and `e0211f0` on the
  local `docs-site` worktree. The exporter injects LuaLS module annotations
  into an isolated source copy; the tagged source rock remains unchanged.

### Native verification

- Ruby focused export tests passed 21 assertions; the complete Ruby outer
  loop passed in 48.58 seconds. It covered 693 public methods across four
  gems, installed-gem examples, signature consumers, and 153 YARD pages.
- Lua focused export tests passed all three cases; LuaLS reported no
  diagnostics for 99 declarations and 592 fields. The complete Lua outer loop
  passed in 47.34 seconds with 307 unit tests, 73 owned-socket live tests on
  luv and Neovim, installed snapshot/quickstart examples, editor completion,
  and the immutable release-source-rock check.
- Both port worktrees are clean. No port branch has been pushed.

### Site verification

- The medium loop passed in 6.35 seconds: 1,226 tests, workspace lint, and
  generated mention/shell checks. Navigation now places all 99 Lua owners and
  all 54 classifiable Ruby owners; the two Ruby base identity types are
  explicitly recorded as unsettled. The negative suite proves all seven
  navigation failures can still trip.
- The final outer loop passed in 46.44 seconds with TypeScript checks and a
  fresh Astro development server/browser run; TypeScript remains on 6.x.
- Revision-bound assembly produced 17,788 pages and checked 2,986,536 links
  with zero broken targets. Pagefind indexed 17,429 English pages. The
  assembled-output suite passed 1,145 tests in 17.00 seconds; API fidelity is
  100% for both Ruby (868 eligible entries) and Lua (704 eligible entries).
- Cross-reference floors are Ruby 435 and Lua 230. The type-link gate records
  the native-language residue (Ruby 2,006 and Lua 516 deliberate plain type
  tokens) and reports no mangled identifiers.
- Ruby/Lua browser coverage passed 318 of 318 checks at 1440, 768, and 390
  pixels in light and dark themes. Responsive table coverage passed 147
  tables; mobile navigation, fonts, native-shell navigation, gp-sphinx style
  parity, and all 36 visual baselines also passed.

### Open completion gates

- `pnpm test:publication` remains open as one uninterrupted command. Its
  Ruby and Lua freshness checks pass, but the fully provisioned workstation
  also detects pre-existing stale committed models for Python, TypeScript,
  Rust, Go, Java, .NET, C++, and Swift before it reaches the already-passing
  assembly/browser phases. Do not describe the manual continuation as a
  passing publication audit.
- The final site workflow SHA is not yet present in the public `libtmux/docs`
  repository, so the port callers cannot yet pin a publicly resolvable site
  commit. Publishing either port branch remains a maintainer action.
- GitHub environments, OIDC trust, IAM prefix ownership, production manifest
  aggregation, real production navigation/search/default routing, and actual
  PR-preview publication and cleanup remain unverified. These require
  repository or infrastructure access and keep first-class support open.
- Repository descriptions and registry homepages remain a maintainer metadata
  handoff after the canonical production URLs work.

## Completion criteria

First-class support is complete when both ports have source-accurate homes,
installation and examples, discoverable unified references, usable shared
widgets, versioned branch/PR builds, and working production search/navigation.
Ruby includes all four gems, not just core. Lua includes explicit MCP and
workspace status pages, with no claims that the scaffolds are usable.

The separate upstream implementation and release of Lua MCP/workspace would
enable those products later. It is not a prerequisite for documenting Lua's
core faithfully, and a status page is not evidence those products exist.

The planning deliverable is complete after this investigation, task list,
three PR scopes, and acceptance gates are reviewed. Every implementation
checkbox above remains open until supported by its own current evidence.
