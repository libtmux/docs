# Language artwork and page metadata

The page route selects its palette and artwork. The site root uses Python's
libtmux cog; workspace pages use the plain tmuxp tiles and MCP pages use the
MCP overlay. Light, dark, and system remain reader preferences. A saved
`theme-name` cannot change the language palette.

## Sources and decisions

The static files under `site/public/brand/` come from the libtmux asset kit,
revision `555f60aff5341d8ba59c7466eb9abb537084c98d`. They cover 15 language
palettes and three products. The current documentation navigation has ten
ports; adding artwork does not claim a new port has published documentation.
F#, Kotlin, and Scala declarations use their own palettes when the route
names that package.

- [GitHub Linguist colors](https://github.com/github-linguist/linguist/blob/538da05f034fa5c83bd81df128d144e208898da3/lib/linguist/languages.yml)
- The original libtmux and tmuxp geometry was supplied by the project owner.
- The MCP overlay uses the symbol, without the wordmark, from the
  [upstream logo](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/088176704a4e8f20e7f1d237de1de8484aa412fd/docs/logo/light.svg).
- The root SVG, PNG, favicon, touch icon, and social cards match the Python
  libtmux artwork in its `logo` branch. Python's `__about__.py` supplies the
  project description and identity links. Its Sphinx configuration must set
  `ogp_image`: the shared gp-sphinx default points to a 192px app icon, and
  changing the older conditional template alone does not replace that tag.

The history investigation used `uvx agentgrep` with `depth:exhaustive` across
tony.sh's old and current locations, social-embed, and Astro. It completed
13,858 source scans, read 860,751 records, and found 21 matching records with
no skipped or failed sources. Relevant findings were checked against current
source rather than treated as implementation instructions:

- tony.sh already connects identities with `sameAs`. Its current layout uses
  a 180px touch icon for `summary_large_image`; a prior review identified the
  need for a separate landscape card. This site uses the exported 1200 × 630
  Open Graph image and 1200 × 600 Twitter image.
- social-embed centralizes title, description, canonical, and Open Graph tags
  in its Astro base layout. This site extends its existing `Seo.astro` owner.
- Astro's minimal example includes SVG and ICO favicon alternatives. This
  site also supplies PNG and Apple touch fallbacks.
- tony.sh and tony.nl use tinted surfaces and shared theme variables. CV's
  `getTextColorForBg` pairs a foreground with its actual background; its
  `consulting-accent-fg` separates filled controls from page text. This site
  uses explicit sRGB shades and separate solid/on-solid tokens. Filled badges
  and primary actions retain white text in both schemes.

Source revisions inspected: tony.sh `9e7604d1`, social-embed `b716ec89`,
CV `c3c1e31c`, tony.nl `b2b74738`, and Astro `3f3d580b`.

### Dark surface hue

The Python navigation chips exposed a Chromium 153 color-mixing problem: mixing
`#15191d` with `#ebf1f6` in OKLCH produced a missing hue with nonzero chroma,
which painted reddish `#292324`. The same mix in OKLab paints `#212529`.
Interface blends now use OKLab, and the browser gate checks the rendered
chip's RGB channels after switching to dark mode. Firefox 155 and WebKit 26.6
already painted the intended color; all three engines agree after this fix.

This follows CV's `packages/colors/src/colors/operations.ts`: its `mix()`
helper interpolates OKLab components to avoid hue artifacts, introduced in
[its color operations](https://github.com/tony/cv/commit/cdac38750f93f5de75ff3216b756a052cc75f810). CV's earlier
[neutral-color correction](https://github.com/tony/cv/commit/3251c59078aa0fbe5a59c2afd749d5f8ea70e338)
also preserves undefined hue and prevents saturation floors from tinting
gray colors. These are related safeguards; the docs fix changes CSS blends.
The [CSS color specification](https://www.w3.org/TR/css-color-4/#missing)
describes missing and powerless components.

A second CV-focused `depth:exhaustive` search completed 13,882 source scans
and read 861,445 records, with 78 matches and no skipped or failed sources.
The matching inspector-theme discussions separate surface, text, border,
and accent roles, including a dedicated white foreground on brand fills.
The earlier hue corrections above came from CV's Git history; the returned
conversation matches did not contain that older debugging discussion.

## Ownership

`ports.ts` owns language abbreviations and page-to-artwork selection.
`brand-palettes.json` owns the language colors and their surface/foreground
pairs. Regenerate the CSS after changing it:

```console
$ node scripts/gen-brand-css.mjs
```

Both the Astro shell and the native shell consume that generated CSS.
`BrandIcons.astro` emits icon and manifest links. `Seo.astro` emits social
images and JSON-LD while preserving the existing canonical, locale, and
version indexing rules. JSON-LD escapes `<` before insertion into a script.

The graph describes the Python library as `SoftwareSourceCode`, the shared
site as `WebSite`, and documentation pages as `TechArticle` or `APIReference`.
Identity links describe the relevant software project, not its author's
personal profiles. The markup follows the [Open Graph image fields](https://ogp.me/)
and [Schema.org's software source type](https://schema.org/SoftwareSourceCode).

`scripts/brand-native-pages.mjs` adds image metadata to assembled native HTML
before publication, preserving native canonical and robots tags. Native
artifacts published by a port's own pinned pipeline need that same build step
when the port adopts the updated docs revision. The browser shell supplies
navigation and palette styling; crawlers receive the metadata in HTML.

## Validation scope

Unit checks cover language/product routing, preview prefixes, image files and
dimensions, JSON-LD escaping, native metadata replacement, and WCAG 4.5:1 text
contrast on page, panel, hover, and filled surfaces. The regular browser check
covers header height, abbreviated tablet navigation, white badge text, and
compact color-scheme controls. The full publication audit remains separate
from these development checks.

Dark mode uses the same slate backgrounds, borders, headings, and body text
for every language. Language color remains in logos, content links, selected
navigation, and small filled accents. Inactive navigation and the prerelease
strip use neutral colors so a port's hue does not tint the whole page.

The Astro header hides color-scheme text below 1280px and keeps full language
names from 832px. At 768–831px it uses abbreviations; narrower displays put
the languages in the menu. Browser checks cover overlap at each transition.
