# native-gp-sphinx-layout.css

Verbatim copy of the declaration-layout stylesheet that native Sphinx Python
pages receive from the published site.

- Source: `https://libtmux.org/en/py/latest/api/_static/css/layout.css?v=ef1b0bba`
  (linked from `https://libtmux.org/en/py/latest/api/api/libtmux.server/`)
- Fetched: 2026-10-25
- Its rules sit in `@layer gp-sphinx`; the native shell rules are unlayered,
  so they win the cascade whatever the selector specificity.

Refetch it when `native-signature-layout.test.ts` is updated for a new
gp-sphinx release.

# native-furo-target.css

The one rule of the Furo theme sheet that highlights a targeted declaration,
trimmed from the full file.

- Source: `https://libtmux.org/en/py/latest/api/_static/styles/furo-tw.css?v=f66ee5e2`
- Fetched: 2026-10-25
- It is `!important`, so no shell fill can flatten the highlight; the shell
  still excludes `:target` from its own fill.
