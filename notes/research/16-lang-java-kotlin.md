# Java and Kotlin reference pipeline

Dokka HTML wins for `libtmux-java` because it is the only tool that reads Javadoc and
KDoc comments in one analysis pass over a repository that mixes both languages. Ship
Dokka's native HTML renderer at tier2-skin-inject — skinned via `customStyleSheets`,
`customAssets` and a `templatesDir` override of five FreeMarker files — and keep bare
`javadoc` doing exactly one job: the CI doclint gate, never the published site.

## The ecosystem convention, and what libtmux.org adds

Maven Central's publish-validation rules require a `-javadoc.jar` alongside every
released artifact. Once it exists, [javadoc.io](https://javadoc.io) serves it
automatically and IDEs resolve it for inline hover, independent of whatever libtmux.org
hosts. javadoc.io is not a decision to fight — it is a mandatory side effect of
publishing to Central — and it stays the fallback for anyone who does not know libtmux
has its own site.

The only real decision is which generator produces that jar's content. Bare `javadoc`
only understands Java, so it would cover five modules and silently drop
`libtmux-kotlin`. Dokka's `plugin-javadoc` renderer produces the same javadoc.io-shaped
HTML from one KDoc+Javadoc pass, covering every module uniformly, so the jar is a Dokka
artifact too.

libtmux.org adds what javadoc.io cannot: a page sharing `sphinx-gp-theme`-derived design
tokens with the other seven ports, at `libtmux.org/java/`, with real versioning and one
Pagefind-indexed search across all eight languages — the `kotlinlang.org/api` pattern
(Dokka HTML with a swapped header and an extra stylesheet layer, confirmed live),
additive on top of the jar rather than a replacement for it.

## Tool decision

**Rejected: bare `javadoc`.** Licensed `GPL-2.0-only WITH Classpath-exception-2.0`
(confirmed literally in `~/study/java/jdk-javadoc/LICENSE`, `ADDITIONAL_LICENSE_INFO`,
and the module header at `src/jdk.javadoc/share/classes/module-info.java:6`, "under the
terms of the GNU General Public License version 2 **only**"). The Classpath Exception
means running it as an external CLI tool never copyleft-infects libtmux's own code — the
real objection is scope, not license: `javadoc` has no Kotlin frontend, so it would only
ever cover a subset of a mixed-language repository.

**Rejected: Doxygen.** `GPL-2.0-only`, no qualifier, and no KDoc/Kotlin understanding.
Excluded on the same permissive-license constraint that routes C++ through
Doxygen-XML-to-Breathe rather than Doxygen's own HTML (`09-licensing.md`) — here there is
no equivalent XML-bridge escape hatch, so it is excluded outright.

**Rejected: javasphinx.** The "give Java its own Sphinx domain, pipe javadoc comments
into `gp-sphinx`" idea, the Java analog of the TypeScript track's hand-written
`docs/api.md`. Archived 2019-03-07 with no Kotlin support ever added — already tried in
this ecosystem and abandoned seven years ago.

**Chosen: Dokka HTML**, `org.jetbrains.dokka:dokka-gradle-plugin` v2.2.0, Apache-2.0.
Reads both KDoc and Javadoc from one Gradle plugin application. Not yet applied in
`libtmux-java` today — `gradle/libs.versions.toml` declares `kotlin-jvm`, `errorprone`,
`spotless` and `maven-publish` only, no `build.gradle.kts` references `dokka`. Adding it
is new build-logic work, not a flag flip on an existing task.

**A sixth module the research undercounted.** `settings.gradle.kts` publishes seven
modules, not the five the capability matrix lists. `libtmux-bom` is a pure Maven BOM POM
with no `src/` directory, correctly outside Dokka's scope — but `libtmux-workspace` has
real sources (eight `.java` files under `src/main/java/io/github/libtmux/workspace/`
plus a test) that the matrix's "5 real submodules" simply missed. The convention plugin
below reaches six modules, not five.

## Verified shell contract

| Contract point | Dokka HTML | Contrast: JDK `javadoc` doclet |
|---|---|---|
| Base path | Free, implicit — every page/resource href renders relative to a computed `pathToRoot`: `if (resource.isAbsolute) resource else "$pathToRoot$resource"` (`DefaultTemplateModelFactory.kt:126,132,140`). No flag exists because none is needed. | No dedicated flag either; unverified against a nested prefix in this pass. |
| Head injection | `customStyleSheets`/`customAssets` (`List<File>`) on `DokkaBaseConfiguration`. `CustomResourceInstaller` copies stylesheets under `styles/`, assets under `images/` — `.js` files land under `images/` too, not a source typo. `base.ftl`'s `<@resources/>` macro emits real `<link>`/`<script>` tags. | `--add-stylesheet <file>` adds a `<link>`; `--main-stylesheet <file>` (alias `-stylesheetfile`) replaces the default. Both live in `javadoc --help` on JDK 26. |
| Header/footer injection | Whole-file only, via `templatesDir`: FreeMarker's `MultiTemplateLoader` tries `templatesDir` first, falls back to the classpath copy (`HtmlTemplater.kt:45-54`). Exactly five overridable files: `base.ftl`, `includes/header.ftl`, `includes/footer.ftl`, `includes/page_metadata.ftl`, `includes/source_set_selector.ftl`. | `-header`, `-top`, `-bottom` splice literal HTML text above/below content and are live. `-footer` is **not** — it prints "This option is no longer supported" and does nothing; `-bottom` is the only working footer mechanism, despite some stale docs still citing `-footer`. |
| Machine-readable output | None from the HTML renderer. A separate `plugin-gfm` CommonMark output exists but is self-reported Alpha (`GfmPlugin.kt:49-58` logs a runtime warning) and wires in none of `CustomResourceInstaller`/`SearchbarDataInstaller`/`StylesInstaller` — no styling, nav or search survives, no frontmatter is emitted. Not a tier1 site-rendering input. It does clear a narrower bar: `10-llms-and-agents.md` uses it as the `markdownBody` source for `llms.txt`, where only resolved body text matters. | HTML5 only, no machine-readable path. |
| Native search | `SearchbarDataInstaller.kt:27-102` writes a static `scripts/pages.json` client index into `header.ftl`'s `#searchBar` div, unconditionally — no flag disables it. Hide it with injected CSS (`#searchBar{display:none}`) so it doesn't sit next to Pagefind, whose own crawl needs `exclude_selectors` on Dokka's sidebar, or `--root-selector` at `#content` (`08-search.md`). | Ships its own JS search index in the standard doclet output; irrelevant since `javadoc` output is never published on libtmux.org. |
| Template override | Working but partial: the five `.ftl` files are replaceable, but `base.ftl`'s `<@content/>` slot — the class/member page body — is filled entirely by Dokka's own Kotlin `HtmlRenderer`. Page-internal layout is never template-driven, regardless of `templatesDir`. | Full replacement needs a custom `-doclet` class — larger than Dokka's file-level override, and still no Kotlin support. |

**i18n note.** The capability matrix flags `base.ftl:5`'s hardcoded `lang="en"` as a risk;
under ledger §3 it dissolves — API reference is never localised for any of the eight
languages, so a generator with zero locale hooks is not a gap here.

**Reconciling build-time injection with runtime chrome.** Ledger §6 wants header,
footer, switcher and tokens loaded at runtime so chrome fixes reach already-published
immutable versions without a rebuild — but Dokka's injection points (`customStyleSheets`,
`customAssets`, `templatesDir`) all fire at build time, baked into each version's static
HTML. Reconcile it the way rustdoc's baked-in CSS is: the baked file is a thin, stable
stub, and the content it pulls loads at runtime. `customStyleSheets` ships one small file:

```css
/* docs/dokka/libtmux-shell.css — the only thing customStyleSheets bakes in */
@import url("https://libtmux.org/_shell/tokens.css");

#searchBar {
  display: none;
}
```

The version switcher rides in via `customAssets` as a `.js` file whose name controls
load timing: `ScriptsInstaller` defaults an injected script to `async`, but a filename
ending in `_deferred.js` gets `defer` instead (`htmlPreprocessors.kt`) — needed because
the switcher must find its mount point in `header.ftl`'s DOM before it runs. Name it
`libtmux-switcher_deferred.js`, have it fetch its markup from the shell URL at runtime,
and mount it at the `<@version/>` macro site in an overridden `includes/header.ftl`.
Override only `header.ftl` and `footer.ftl`; leave `base.ftl` stock, so a future Dokka
release adding a macro call inside `base.ftl` cannot break a file you own.

**Open: no canonical tag.** No hit for "canonical" or "sitemap" anywhere in Dokka's
templates or `plugin-base` Kotlin source, and `DokkaBaseConfiguration` has no field for
one. Ledger §2.3's separate-builds-with-a-canonical-tag decision has no native flag to
carry it out here, unlike the Astro-rendered languages where `canonical` is a build
option. Injecting one means a build-time rewrite of a copied `page_metadata.ftl` or a
runtime script — neither verified. Treat `/java/stable/` duplicate-content exposure as
open, not solved.

## Build command

Apply Dokka to the six modules with real sources — `libtmux`, `libtmux-jackson`,
`libtmux-kotlin`, `libtmux-junit5`, `libtmux-mcp`, `libtmux-workspace` — via a new shared
convention plugin, the same pattern `libtmux.java-library.gradle.kts` already uses for
Javadoc doclint:

```kotlin
// build-logic/src/main/kotlin/libtmux.dokka.gradle.kts
plugins {
    id("org.jetbrains.dokka")
}

dokka {
    pluginsConfiguration.html {
        customStyleSheets.from(rootProject.file("docs/dokka/libtmux-shell.css"))
        customAssets.from(rootProject.file("docs/dokka/libtmux-switcher_deferred.js"))
        templatesDir.set(rootProject.file("docs/dokka/templates"))
        footerMessage.set("libtmux contributors")
        homepageLink.set("https://libtmux.org/java/")
    }
}
```

`pluginsConfiguration.html` does not propagate from root to submodules
(Kotlin/dokka#3883, closed by redirect to still-open #2419) — this convention plugin
must be applied to each of the six modules individually, plus a root aggregator that
collects them into one publication:

```kotlin
// build.gradle.kts (root) — aggregates every module's Dokka output into one HTML site
dependencies {
    dokka(project(":libtmux"))
    dokka(project(":libtmux-jackson"))
    dokka(project(":libtmux-kotlin"))
    dokka(project(":libtmux-junit5"))
    dokka(project(":libtmux-mcp"))
    dokka(project(":libtmux-workspace"))
}
```

Then run the aggregate HTML task — the exact task name confirmed literal in Dokka's own
`DokkaPluginFunctionalTest.kt:80` and `DokkaGeneratorLoggingTest.kt`:

```console
$ ./gradlew dokkaGeneratePublicationHtml
```

Output lands at `build/dokka-docs/html/` by default
(`DokkaExtension.kt:36-47`'s doc comment for `basePublicationsDirectory`).

Separately, generate the mandatory Maven Central jar per module — per-module, not
aggregated, since each module publishes its own artifact under group `io.github.libtmux`
(confirmed in `build-logic/src/main/kotlin/libtmux.publication.gradle.kts:15`, publisher
`com.vanniktech.maven.publish`):

```console
$ ./gradlew dokkaGeneratePublicationJavadoc
```

This feeds javadoc.io — once a module ships to Central, its jar is reachable at
`javadoc.io/doc/io.github.libtmux/<module>`. `plugin-javadoc`'s `ResourcesInstaller`
hardcodes its own `static_res` bundle and never reads `DokkaBaseConfiguration`
(`htmlPreprocessors.kt:21-31`), so none of the site's theming leaks into the jar —
deliberately: it is expected to look like stock javadoc.io, not the branded site.

## Where the output lands

`dokkaGeneratePublicationHtml`'s tree syncs verbatim to
`s3://libtmux-docs/java/v${VERSION}/api/` (bucket name per ledger §7.3), mirrored to
`/java/stable/api/` and `/java/latest/api/` as separate builds per ledger §2.3, matching
the `/java/` prefix used throughout `07-ci-topology.md` and
`11-information-architecture.md`. Astro-authored guide prose for the same family
(including the Kotlin getting-started page) lives alongside it at `/java/vX.Y.Z/guide/`.
`--delete` in the sync step scopes to the `java/` prefix only, never the bucket root.

## CI step

`docs-java` runs in `libtmux-java`'s own CI, after the existing `check` gate that already
runs Javadoc doclint. No extra Node/bun toolchain is needed — unlike TypeScript, Go and
.NET, Dokka is self-hosting (`07-ci-topology.md`'s CI table: "— (Dokka is
self-hosting)"). The job: `./gradlew dokkaGeneratePublicationHtml` → sync to
`s3://libtmux-docs/java/*` via `aws s3api put-object` with conditional writes as a
backstop → `aws cloudfront create-invalidation` scoped to `/java/stable/*`,
`/java/latest/*` and the manifest (ledger §7.5), never the whole `/java/*` root, under
`concurrency: {group: docs-java, queue: max}` (ledger §7.6). `dokkaGeneratePublicationJavadoc`
runs as a separate step feeding the Maven Central publish job, unrelated to the site sync.

## Open risks

- **Missed-module fallback is silent.** A module left out of the convention-plugin
  rollout — especially the newly-identified sixth, `libtmux-workspace` — keeps building
  with Dokka's stock, unbranded theme for that module only. Nothing fails; review has to
  catch it.
- **`templatesDir` is pinned to Dokka 2.2.0's macro contract.** Leaving `base.ftl` stock
  protects the two files this project owns, but a macro removed or renamed inside
  `header.ftl`/`footer.ftl` themselves still breaks silently. Diff on every version bump.
- **A third dark-mode key enters the git-pull.com family.** Dokka's own toggle persists
  under `localStorage["dokka-dark-mode"]` (`platform-content-handler.js:31`), independent
  of the still-open choice in ledger §7.13 between `starlight-theme` and
  `libtmux-theme`. The injected CSS/JS should suppress Dokka's own toggle and drive the
  shared shim instead of coexisting with a third scheme.
- **No canonical mechanism**, covered above — the `/java/stable/` duplicate-content
  question ledger §2.3 raises for every language has no native Dokka answer yet.
- **GFM stays Alpha at 2.2.0.** Fine as the resolved-Markdown source for `llms.txt`'s
  `markdownBody`; not a candidate for anything styling- or nav-dependent.
- **`plugin-versioning` is a second, incompatible versioning mechanism**, needing a
  pre-populated `olderVersionsDir` of every prior version's full HTML build. Fold
  Java/Kotlin into the same per-prefix build loop as the other seven languages instead.
- **NOTICE retention.** Dokka ships a top-level `NOTICE.txt` (Apache-2.0's retention
  clause). Surface its text at `/third-party-notices/` alongside doc2go's, DocC's and
  docc-render's (ledger §7.10 gap 4) — nobody has built that page yet.
