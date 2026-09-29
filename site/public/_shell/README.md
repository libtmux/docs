# Native reference navigation and theme

The shared assets give native reference pages the site's navigation, version
switcher, API equivalents, and theme. Assets live under the locale's `_shell/`
directory, including the preview prefix when present.

| File | Purpose |
| --- | --- |
| `shell.js` | Header, footer, port and version switching, and theme synchronization. |
| `tokens.css` | Shared light and dark theme values. |
| `sphinx.css` | Maps shared tokens to Furo's CSS variables. |
| `brand.css` | Port colors and artwork used by native pages. |

## Sphinx integration

After Sphinx builds the selected source revision, `scripts/build-site.sh`
runs `scripts/normalize-native-shell.mjs`. It copies `sphinx.css` to the
reference's `_static/libtmux-org.css`, then adds its stylesheet and the shared
script to each page. Existing integration is replaced once; redirects retain
their original behavior. This step does not edit source checkouts or their
Sphinx configuration.

The stylesheet loads after the native theme and imports the locale's
`_shell/tokens.css`. Its fallbacks retain Furo colors if shared tokens cannot
load. Other native asset URLs are normalized to the same locale and preview.

This allows older library revisions to receive the current site navigation
without requiring shell integration in their own source tree. A standalone
Sphinx build remains controlled by its repository's configuration.

## Runtime contracts

`shell.js` reads `versions.json` and `page-links.json` from the locale root.
The generated port table comes from `site/src/lib/ports.ts`; regenerate it
with `node scripts/gen-shell-ports.mjs` after changing port identities.

Native pages read Astro's `color-scheme` preference first, translating
`system` to Furo's `auto`. Native toggles update that key, Furo's `theme`,
and the legacy `libtmux-theme` key. Test navigation in both directions when
changing this contract.

The script and tokens use stable URLs so navigation and theme fixes can reach
previously published references. Changes must preserve existing page contracts.

## Verification

After assembling the site, run:

```console
$ node scripts/inject-shell.mjs --site _site
```

The check inspects every built Sphinx page for the script and stylesheet,
checks locale URLs, and compares the adapter's variables with the generated
theme and shared tokens. Missing references are reported as skips. Broken
integration fails the command.

The output tests cover native asset paths; `normalize-native-shell.test.ts`
covers older sources, existing integration, previews, redirects, repeated
assembly, and malformed HTML. Use a browser to verify switching, themes, and
layout on the assembled native pages.
