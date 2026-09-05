# .NET and C# reference pipeline

Use `docfx metadata --outputFormat apiPage` as a pure Roslyn extractor, never `docfx
build`'s own HTML stage: point it at the four real library `.csproj` files (not
`LibTmux.slnx`, which also pulls in examples, benchmarks and tests), and feed the
resulting per-page YAML plus `toc.yml` into a hand-built Astro renderer at `/dotnet/`.
`~/work/libtmux/libtmux-dotnet/docs/public-api.json` is not usable as that renderer's
source — it carries one-line summaries, not prose — but it is a genuine supplementary
data source docfx cannot produce on its own.

## The ecosystem convention, and what libtmux.org adds

.NET has no `docs.rs`/`pkg.go.dev` equivalent. The primary surface for C# API docs is
the IDE — XML doc comments (`///`) surfaced as IntelliSense tooltips — and NuGet.org
itself renders only a package's `README.md`, not generated reference. Where a library
does publish a docs website, the convention is a DocFX-generated static site, because
DocFX's bundled "modern" template is a deliberate visual clone of
`learn.microsoft.com/dotnet/api`: dense signature blocks, a facts panel (namespace,
assembly, inheritance chain), and a right-rail in-page TOC. Two supplementary hosts,
[fuget.org](https://fuget.org) and [dndocs.com](https://dndocs.com), exist but hold no
canonical status the way docs.rs does for Rust.

libtmux.org keeps that visual idiom — the Astro renderer should reproduce the
signature-block/facts-panel density, not import Sphinx's Furo-shaped layout wholesale —
while adding what no .NET convention supplies: a version-independent `/dotnet/stable/`
alias, one Pagefind index shared with the other seven languages, and the same
`sphinx-gp-theme`-derived design tokens.

## Tool decision

docfx (MIT, `~/study/c#/docfx`) is genuinely two tools in one binary: `docfx build`
produces a complete themed HTML site, and `docfx metadata` is a separate Roslyn-based
extractor with three output formats. We use the extractor only.

| Mode | What it does | Verdict |
|---|---|---|
| `docfx build` | Full HTML site via the "modern" Mustache template | Rejected as the renderer — see shell contract below; kept only as a documented fallback |
| `docfx metadata --outputFormat mref` | Legacy "ManagedReference" YAML, the pre-template model `docfx build` consumes internally | Superseded by `apiPage` for this pipeline — cross-references are left as unresolved `xref:` UIDs |
| `docfx metadata --outputFormat apiPage` | Structured `Block[]` YAML per page (`docs/docs/api-page.yml`), **chosen** | Cross-references pre-resolved to `{text, url}` at generation time — confirmed against the shipped fixture `test/docfx.Tests/SerializationTests/TestData/ApiPage/BuildFromProject.Class1.Issue8696Attribute.yml`: same-project refs get flat `Namespace.Type.html`-style filenames, external BCL refs already point at absolute `learn.microsoft.com` URLs |

**On the `_appTemplate` override named in this document's brief: it does not exist in
current docfx** — a search of the entire cloned repository for `_appTemplate` returns
zero matches; that name is stale Sandcastle-era terminology. The real, current override
mechanism is a `template` array in `docfx.json` (or `-t dir1,dir2` on the CLI) layering
directories with last-filename-wins on collision, plus `docfx template export modern` to
eject the bundled template to disk first — documented, but with no compatibility
contract beyond "same filename wins": a version bump restructuring `_master.tmpl`'s
partials breaks a forked copy silently. Moot for the chosen `apiPage` path, since no
template is ever invoked.

**Alternative considered: DefaultDocumentation** (MIT-0,
`~/study/c#/DefaultDocumentation`). It decompiles a built assembly plus its sidecar XML
doc file via `ICSharpCode.Decompiler` — confirmed from
`source/DefaultDocumentation.Api/DefaultDocumentation.Api.csproj`'s package reference —
emitting flat, per-member Markdown with no resolved cross-reference model. Rejected: it
must run strictly after `dotnet build` produces the assembly, where docfx compiles from
source directly via `MSBuildWorkspace`, and its output is leaner but less structured than
`apiPage`'s resolved `Block[]` model. Also rejected: Sandcastle Help File Builder
(MS-PL, VS-integrated CHM/MSHelp tooling, wrong era for a JAMstack pipeline), Statiq.Docs
(dual-licensed, fails the permissive bar), and xmldoc2md/XmlDocMarkdown (both stale,
superseded by docfx's own Markdown/`apiPage` output).

## Target the four real library projects, not the solution

Four `/src/` projects carry `GenerateDocumentationFile`/`IsPackable`/a `PackageId` —
confirmed per-`csproj` — and are the real target. `examples/LibTmux.Examples` and
`benchmarks/LibTmux.Benchmarks`, also listed in `LibTmux.slnx`, sit under separate
top-level folders and are out of scope:

| Project | `PackageId` | Notes |
|---|---|---|
| `src/LibTmux` | `LibTmux` | The core package; sole subject of `public-api.json`'s deepest coverage |
| `src/LibTmux.Query.Json` | `LibTmux.Query.Json` | JSON converters for the query AST |
| `src/LibTmux.Workspace` | `LibTmux.Workspace` | Declarative session-layout format |
| `src/LibTmux.Mcp` | `LibTmux.Mcp` | `OutputType Exe` but still `IsPackable` — an MCP server, documented alongside the libraries |

Point `docfx metadata`'s `src[].files` at these four `.csproj` paths explicitly, never at
`LibTmux.slnx` or a `src/**/*.csproj` glob — an explicit list is the more auditable
choice and avoids silently picking up a future `src/LibTmux.*` project not meant for the
public site.

## Is `public-api.json` a usable API model? No — but it is a real supplementary source

Read directly: 177 types, 1,287 members, `status: "approved-contract-only"`, pinned at
`sourceRevision: c4a980b` — the same commit `docs/parity/parity-ledger.json` pins,
confirming the two are generated together. Every member carries only a one-line
`summary` (`"Performs Get."`, `"The Size value."`) with no `remarks`, no per-parameter
description, no `returns` text beyond the signature, and no worked examples outside four
top-level curated snippets. It covers only two of the four packages above — its
`packages` array lists `LibTmux` and `LibTmux.Query.Json`; `LibTmux.Workspace` and
`LibTmux.Mcp` have no entry at all. **It cannot stand in for a reference page**: there is
no prose to render.

What it does carry that Roslyn extraction cannot: `portable`, `performsIO`,
`processBacked`, `platformAnnotations` (e.g. `UnsupportedOSPlatform("windows")`),
`missingBehavior` (e.g. `"throws TmuxObjectNotFoundException"`), and a `conventions`
block (`io: "async-only"`, `entityMutation: "returns immutable replacement"`) — genuine
cross-language contract annotations worth surfacing as a callout on the rendered page,
sourced separately from docfx's model.

**The join is not a string match.** `public-api.json`'s own `memberIdFormat` field
declares `xmlDocumentationIds: false`: its IDs (`M:LibTmux.Client.GetAsync(Server,
string, CancellationToken)`) look like compiler XML doc comment IDs but use short
C#-source-form type names and nullable markers instead of the fully-qualified BCL
parameter types a real compiler-generated `commentId` (as seen in the ApiPage fixture,
`T:BuildFromProject.Class1.Issue8696Attribute`) would use. Joining the two files by ID
needs a small contract-v1-to-XML-doc-ID normaliser, not an
equality check.

## Shell contract

| Contract point | `docfx build` (unused) | `docfx metadata` (extractor) | Our Astro renderer |
|---|---|---|---|
| Base path | Document-relative `_rel` computed by `SystemMetadata.cs`, consumed by every asset href in `_master.tmpl` — safe at any nesting depth | N/A, no HTML | Astro `base` set per build; `/dotnet/stable/` and `/dotnet/latest/` are separate builds with `canonical` set to the alias URL (ledger §2.3) |
| Head injection | No raw `<head>` slot; only typed fields (`_appTitle`, `_appFaviconPath`, `_appLogoPath`); a stylesheet swap works via same-named-file override through `theme` | N/A | Ours — shared `BaseLayout.astro`, loaded at runtime per ledger §6 |
| Header / footer | Footer via `{{{_appFooter}}}` at `_master.tmpl:153`, triple-mustache raw HTML, one config value. Header/nav has no equivalent field — needs a full `_master.tmpl` fork | N/A | Shared components loaded at runtime, so chrome fixes reach published immutable versions without a rebuild |
| Machine-readable output | N/A, this is the terminal HTML stage | **Yes, by design.** `apiPage` YAML, `{text,url}`-resolved, plus a real `toc.yml` nav tree (`DotnetApiCatalog.Toc.cs:55`, `YamlMime.TableOfContent`) — the Astro sidebar can parse `toc.yml` directly instead of reconstructing hierarchy from per-page `facts: Namespace` fields | `llms.txt`/`llms-full.txt` render from the same resolved content-collection entries the HTML pages use, per `10-llms-and-agents.md` |
| Native search | `ExtractSearchIndex` post-processor emits `index.json`, searched by a Lunr Web Worker; disable via `_enableSearch: false` and omitting the processor to avoid duplicating Pagefind | N/A | Pagefind crawls the rendered HTML; bundle lands at `/dotnet/pagefind`, merged per `08-search.md` |
| Template override | `template`/`-t` layering, see Tool decision above | N/A, no template invoked | We are the template — full design control is the actual cost of no themable extractor-consuming renderer existing |
| Versioning | `groups` (`BuildJsonConfig.cs`) only fans one build into multiple output dirs — no switcher UI, no "latest" alias, in either mode | — | Our own `versions.json` manifest and switcher component, shared with the other seven ports |

## Build command

Restore first — docfx's `MSBuildWorkspace` design-time build needs restored
dependencies even with no NuGet packages missing:

```console
$ dotnet restore LibTmux.slnx
```

Extract metadata via a `docfx.json` pointed at the four library projects (create at
`docs/docfx.json`):

```json
{
  "$schema": "https://raw.githubusercontent.com/dotnet/docfx/main/schemas/docfx.schema.json",
  "metadata": [
    {
      "src": [
        {
          "files": [
            "src/LibTmux/LibTmux.csproj",
            "src/LibTmux.Query.Json/LibTmux.Query.Json.csproj",
            "src/LibTmux.Workspace/LibTmux.Workspace.csproj",
            "src/LibTmux.Mcp/LibTmux.Mcp.csproj"
          ],
          "src": ".."
        }
      ],
      "properties": {
        "TargetFramework": "net10.0"
      },
      "outputFormat": "apiPage",
      "dest": "../artifacts/docfx/api"
    }
  ]
}
```

`properties.TargetFramework` matters because all four projects multi-target
`net8.0;net10.0` — omitting it makes docfx build each TFM internally, doubling
extraction time for no benefit to a single reference build.

```console
$ docfx metadata docs/docfx.json
```

`docfx` itself is a `dotnet tool`, installed pinned rather than floating:

```console
$ dotnet tool install docfx \
    --version 2.78.5 \
    --tool-path ./tools
```

## Where the output lands

`artifacts/docfx/api/*.yml` (one file per page) plus `toc.yml` feed the content-layer
loader — worth spiking as `glob({ pattern: "**/*.yml" })` per `24-astro-shell.md` before
writing a custom loader, since `apiPage`'s per-page shape is close to `file()`'s flat
assumptions. The Astro build then writes static pages to
`s3://libtmux-docs/dotnet/v0.0.0-alpha.10/api/` (bucket and prefix per ledger §7.3/§7.4),
mirrored as separate builds at `/dotnet/stable/api/` and `/dotnet/latest/api/` (ledger
§2.3) — never a second sync of the same bytes. `--delete` in the sync step is scoped to
the `dotnet/` prefix only.

## CI step

No docs job exists in `libtmux-dotnet`'s CI today — `dotnet.yml` runs
`render_api_reference.py --check` against `public-api.json`, unrelated to this pipeline.
Per ledger §7.7, the Astro satellite build runs in `libtmux-dotnet`'s own CI, not a
shared monorepo job, alongside `manifest/dotnet.json` as this repo's exclusive manifest
key (per `07-ci-topology.md`'s nine-owner table): `dotnet restore` → `docfx metadata` →
`oven-sh/setup-bun` (the runner image ships the .NET SDK but not bun) → the normaliser →
`astro build --site ...` → `aws s3api put-object` with conditional writes as a backstop,
wrapped in `concurrency: {group: docs-deploy, queue: max}` (ledger §7.6, never combined
with `cancel-in-progress: true`). Invalidation touches only `/dotnet/stable/*`,
`/dotnet/latest/*`, and the manifest — never the whole `/dotnet/*` root (ledger §7.5).

## Open risks

- **`apiPage`'s stability contract is unverified beyond "it works today".** Nothing in
  the docs or release notes marks the format itself experimental — the schema's
  `preview` field flags individual API members (e.g. an `[Experimental]` attribute), not
  the format — but it is newer than `mref`, which `docfx build` still consumes
  internally. Re-check the schema on every docfx version bump; pin the tool version.
- **The two-of-four contract gap.** `public-api.json` covers `LibTmux` and
  `LibTmux.Query.Json` only; any page annotation sourced from it silently has nothing to
  show for `LibTmux.Workspace`/`LibTmux.Mcp` members until that contract is extended —
  the renderer must treat the annotation as optional per-member, not assumed present.
- **The ID-grammar bridge doesn't exist yet.** Joining `public-api.json` rows to docfx's
  `commentId` needs a normaliser translating `libtmux-csharp-contract-v1` (short type
  names, retained nullable markers) into real XML documentation ID form — untested
  against the full 1,287-member set, only spot-checked here.
- **`toc.yml`'s `href` targets are extractor-relative filenames**, not Astro routes; the
  same uid-to-slug regex the ApiPage `{text,url}` cross-references need also has to run
  over every `toc.yml` node before the sidebar links correctly.
- **A docfx bump can change the `apiPage` shape with no compatibility contract**, unlike
  `mref`, which has shipped unchanged for years as `docfx build`'s own internal input.
  Add a schema-drift assertion in the loader — a required-keys check on the first parsed
  page — so a silent shape change fails CI instead of producing a blank page.
