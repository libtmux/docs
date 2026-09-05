# License audit

Every documentation tool in the libtmux.org pipeline clears a permissive-licensing
preference for the only thing that matters: being run to produce docs and publishing
the result. Two tools need a stronger argument than "it's GPL, so what" —
sphinxcontrib-rust is ruled out, and Doxygen must never be forked — and both are
resolved below without touching the recommended architecture.

## The rule that governs everything

Copyleft (GPL, AGPL) obligations attach to **distributing** a program — as source, as a
binary, or as a modified fork — not to **running** it. Piping libtmux's own source
through a GPL tool in CI and publishing the HTML that comes out does not turn
libtmux.org into a GPL work: the output is a new work authored from the input, not a
copy of the tool. Doxygen's own source states this about its own output, repeatedly,
across its codebase (`grep -rc "not affected by this license" ~/study/c++/doxygen/`
matches well over a hundred files): "Documents produced by Doxygen are derivative works
derived from the input used in their production; they are not affected by this
license." The only thing any GPL tool below can trigger is redistributing a copy of the
tool itself, and only a *patched, unpublished* copy actually creates an obligation —
shipping stock `doxygen` changes nothing, since its own source is already public.

## The distinction that decides things here

Three cases, increasing in strength:

1. **Running a GPL binary.** Doxygen invoked as a subprocess to emit XML, consumed and
   discarded. No obligation — this is the case above.
2. **Importing a GPL library into your process.** A GPL Sphinx extension registered via
   `extensions = [...]` in `conf.py` shares one Python interpreter and address space with
   the rest of the build, rather than being spawned as an arm's-length external process.
   Under the FSF's own GPL FAQ treatment of plugins loaded into a running program, that
   is the "combined work" case, not "mere aggregation" — a materially stronger argument
   for copyleft attaching to anything that declares the extension as a dependency.
3. **Forking a tool to theme it.** Distributing a patched copy of a GPL tool — even just
   its bundled CSS — triggers GPL's copyleft on that copy. This is why Doxygen must never
   be forked to reskin it, even though running it unmodified is fine.

## Applying it

**Doxygen (GPL-2.0) is acceptable as an XML-only build step.** Set
`GENERATE_HTML = NO`, `GENERATE_XML = YES` in the Doxyfile. The C++ route is Doxygen
XML → Breathe (BSD-3-Clause) → Sphinx, so no Doxygen-produced HTML is ever published —
the copyleft question doesn't just clear, it's moot. Reskinning stays available without
forking should the XML route ever be abandoned: `HTML_EXTRA_STYLESHEET` and
`LAYOUT_FILE` are documented config keys (`~/study/c++/doxygen/src/config.xml:3522`),
and the Doxygen Awesome project (MIT) proves the point by using exactly those keys.

**sphinxcontrib-rust (GPL-3.0-or-later) is ruled out — case 2 above, not case 1.**
Confirmed from `~/study/rust/sphinxcontrib-rust/LICENSE` (full GPLv3 text) and
`setup.py:90` (`license="GPL-3.0-or-later"`). It is Python code imported directly into
the Sphinx process via `def setup(app)` (`sphinxcontrib_rust/__init__.py:199`), not a
subprocess whose output is consumed at arm's length — the same pattern that clears
Doxygen and rustdoc does not clear this. This is independent of the separate finding
that rustdoc's `--output-format=json` is nightly-only in 2026 (`config.rs:465-469`,
tracking issue rust-lang/rust#76578, still open): sphinxcontrib-rust's Rust-parsing half
(`sphinx-rustdocgen`) parses source directly via `syn` and has no dependency on
`rustdoc-types` or JSON output at all, so a future JSON stabilization would not change
this exclusion. Only a license change, or replacing the tool, would.

**Never fork Doxygen to reskin it.** Not needed anyway — the XML route above sidesteps
the question entirely, and the HTML-level escape hatches exist if it's ever revisited.

## Full audit table

SPDX ids below are verified from the `LICENSE` file in each tool's shallow clone under
`~/study/`, or from the installed `package.json`/`LICENSE` in
`~/work/typescript/social-embed/packages/site/node_modules/` for the Astro-side
dependencies, which is the actual shell we ported.

| Tool | Role in the pipeline | SPDX (verified) | Evidence | Obligation from using it |
|---|---|---|---|---|
| Sphinx | Python + C++ build engine | `BSD-2-Clause` | `~/study/python/sphinx/LICENSE.rst` | None |
| Furo | Base theme `sphinx-gp-theme` forks | `MIT` | `~/study/python/furo/LICENSE` | None |
| gp-sphinx / sphinx-gp-theme | Our own theme, unchanged from today | `MIT` (own code) | `~/work/python/gp-sphinx/LICENSE` | None on our code; the package separately ships `packages/gp-furo-theme/LICENSE-FURO`, an attribution notice for ported Furo files — the precedent for the notices page below |
| Doxygen | C++ XML extraction only (`GENERATE_HTML=NO`) | `GPL-2.0` | `~/study/c++/doxygen/LICENSE`; per-file grant e.g. `src/fileinfo.h:3-13` | None — run, not distributed; never fork to reskin |
| Breathe | Doxygen XML → Sphinx bridge | `BSD-3-Clause` | `~/study/python/breathe/LICENSE` | None |
| sphinxcontrib-rust | — (ruled out, not in the pipeline) | `GPL-3.0-or-later` | `~/study/rust/sphinxcontrib-rust/LICENSE`, `setup.py:90` | **Ruled out** — loaded in-process into `sphinx-build`, a combined work, not run-and-consume |
| api-extractor | TypeScript reference: `.d.ts` → `index.api.json` | `MIT` | `~/study/typescript/rushstack/apps/api-extractor/LICENSE` | None |
| rustdoc | Rust reference HTML, reskinned | `MIT OR Apache-2.0` | `~/study/rust/rust/LICENSE-MIT`, `LICENSE-APACHE` (no top-level `NOTICE` file to reproduce) | None; reskin via `--extend-css`/`--html-in-header`, both stable on rustc 1.97.1+ — no fork |
| doc2go | Go reference, `-embed` mode | `Apache-2.0` | `~/study/golang/doc2go/LICENSE` | NOTICE retention if redistributing — doc2go ships no separate `NOTICE.txt` today, so nothing to reproduce beyond keeping the license text with any vendored fragment |
| Dokka | Java + Kotlin reference HTML | `Apache-2.0` | `~/study/kotlin/dokka/LICENSE.txt`, `NOTICE.txt` | NOTICE retention — 7-line file, JetBrains copyright |
| javadoc | JDK doclet — CI doclint gate only, not the published site | `GPL-2.0-only WITH Classpath-exception-2.0` | `~/study/java/jdk-javadoc/LICENSE`, `ADDITIONAL_LICENSE_INFO`; "only" confirmed literally, e.g. `src/jdk.javadoc/share/classes/module-info.java:6` | None — the Classpath Exception exists precisely so using the JDK's own tooling never copyleft-infects your code or its output. Dokka, not javadoc, renders the published Java/Kotlin pages; the mandatory Maven Central `-javadoc.jar` is also produced by Dokka's `plugin-javadoc`, not bare `javadoc` |
| DocFX | .NET reference (`docfx metadata` YAML) | `MIT` | `~/study/c#/docfx/LICENSE` | None |
| swift-docc | Swift reference, DocC Archive/JSON | `Apache-2.0 WITH Swift-exception` | `~/study/swift/swift-docc/LICENSE.txt`, `NOTICE.txt` | NOTICE retention |
| swift-docc-render | Renders the DocC archive; `header.html`/`footer.html` injection point | `Apache-2.0 WITH Swift-exception` | `~/study/swift/swift-docc-render/LICENSE.txt`, `NOTICE.txt` | NOTICE retention — the compiled Vue bundle ships to every Swift reference page |
| Astro | Shell framework | `MIT` | `~/study/typescript/astro/LICENSE`; `packages/site/node_modules/astro` | None |
| Vite | Build pipeline (via Astro 7 / Rolldown) | `MIT` | `packages/site/node_modules/vite/package.json` | None |
| Tailwind CSS | Shell styling | `MIT` | `packages/site/node_modules/tailwindcss/package.json` | None |
| `@astrojs/mdx` | MDX content | `MIT` | `packages/site/node_modules/@astrojs/mdx/package.json` | None |
| astro-expressive-code | Code block rendering | `MIT` | `packages/site/node_modules/astro-expressive-code/LICENSE` | None |
| Pagefind + `@pagefind/default-ui` | Site search | `MIT` | `~/study/rust/pagefind/pagefind/Cargo.toml`; `packages/site/node_modules/pagefind` | None |
| satteri | Markdown processor | `MIT` | `packages/site/node_modules/satteri/LICENSE` | None |
| `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` | Bundled fonts | `OFL-1.1` | `packages/site/node_modules/@fontsource/ibm-plex-sans/LICENSE` | See "font licensing" below — OFL, not MIT/BSD/Apache |
| Weblate | Self-hosted translation service | `GPL-3.0-or-later` | `~/study/python/weblate/LICENSE`, REUSE manifest `LICENSES/GPL-3.0-or-later.txt` | None — a self-hosted *service*, not a distributed artifact; running it, patched or not, imposes nothing unless the patched source is withheld from redistribution |
| Crowdin | Alternative to Weblate: proprietary SaaS | Proprietary service; CLI `MIT` | `~/study/java/crowdin-cli/LICENSE` | None from the CLI. Not a copyleft question at all — it's a vendor-lock-in question |

## Font licensing is its own question

IBM Plex ships under the SIL Open Font License 1.1, not MIT/BSD/Apache — a different
family with different terms. OFL permits embedding, bundling and redistributing the
font files freely, including in a commercial product, and does **not** require
publishing any of *our* source in exchange. Its only real restriction is the Reserved
Font Name clause: a modified version of the font may not keep using the name "IBM Plex"
without permission. We are not modifying the font, only loading it via
`@fontsource/ibm-plex-{sans,mono}` and self-hosting the static files (confirmed as the
shell's current approach in `packages/site/package.json`), so the only obligation is
keeping the OFL license text — `~/work/typescript/social-embed/packages/site/node_modules/@fontsource/ibm-plex-sans/LICENSE`
— next to the vendored font files, same as any other bundled third-party asset.

## Tools whose theming strategy would require forking

None of the tools actually chosen for the architecture need a fork for the theming this
project does:

- **Doxygen** — not fork-required. XML-only means the question is moot; `HTML_EXTRA_STYLESHEET`/`LAYOUT_FILE` cover a reskin if ever needed.
- **rustdoc** — not fork-required for the planned CSS/header injection (`--extend-css`, `--html-in-header`, both stable). A *structural* HTML rewrite would need either a fork or the nightly-only JSON output — neither is in scope.
- **Dokka** — not fork-required; `customStyleSheets`/`customAssets`/`templatesDir` are first-class Gradle plugin parameters.
- **doc2go** — not fork-required; `-embed` injects a custom landing page and raw HTML/CSS without touching doc2go's own templates (a fork would need rebasing on every doc2go release — the exact maintenance cost this architecture avoids).
- **DocFX** — not fork-required; template export/override is a documented CLI surface.
- **swift-docc-render** — fork-required only for *deep structural* restructuring of its Vue SPA. The chosen mechanism, `header.html`/`footer.html` fragments discovered automatically by `docc convert` (ledger §7.1), needs no fork.

The one tool this project must never fork regardless of mechanism is **Doxygen**, per
the ledger's explicit instruction — forking a GPL tool to theme it is the one path that
actually triggers redistribution obligations, and it's also the one tool where the
non-forking path (XML-only) is already the chosen architecture, not a fallback.

## Where the NOTICE text goes

The design set names NOTICE-retention obligations for doc2go, Dokka, swift-docc and
swift-docc-render but never says where that text is surfaced. Every one of these tools
ships bytes into a published reference page — Dokka's and doc2go's HTML/CSS/JS, docc-render's
compiled SPA bundle — so "keep the license file somewhere in the repo" is not enough;
a reader looking at the live site needs a page to find.

**Proposal:** a single `/third-party-notices/` route in the Astro shell, generated
at build time from a checked-in manifest (tool name, SPDX id, license URL, and the
upstream `NOTICE.txt` verbatim where one exists), covering:

- Dokka's `NOTICE.txt` (JetBrains copyright, Apache-2.0 §4(d))
- swift-docc's and swift-docc-render's `NOTICE.txt` files (Apple/Swift project, Apache-2.0 WITH Swift-exception)
- doc2go's `LICENSE` (Apache-2.0, no separate NOTICE shipped upstream — reproduce the license grant, note that no additional notice exists)
- rustdoc's bundled fonts (`Fira-LICENSE.txt`, `SourceCodePro-LICENSE.txt`, `SourceSerif4-LICENSE.md`, `NanumBarunGothic-LICENSE.txt`, all OFL-1.1) if the Rust reference page ever inherits rustdoc's default font stack instead of the shell's own IBM Plex
- the `@fontsource/ibm-plex-*` OFL text
- the Astro-side MIT dependency list (Astro, Vite, Tailwind, MDX, astro-expressive-code, Pagefind, satteri), for completeness even though MIT imposes no more than copyright retention

Link it from the shared footer component (`packages/site/src/layouts/BaseLayout.astro`
in the ported shell), next to the version and locale switchers, so it appears on every
page regardless of language prefix — one link, one page, generated once and served at
the shell's mutable prefix like the rest of the chrome (per the ledger's runtime-loaded
footer rule). `gp-sphinx`'s own `packages/gp-furo-theme/LICENSE-FURO` is the existing
in-house precedent for this pattern: a dedicated attribution file for a permissively
licensed derivative, checked into the repo and shipped alongside the code that uses it.
