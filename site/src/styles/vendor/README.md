# Vendored from gp-sphinx

`gp-sphinx-api.css` is `sphinx-autodoc-api-style`'s `api_style.css` and the
card-level rules of `sphinx-ux-autodoc-layout`'s `layout.css`, from
`~/work/python/gp-sphinx`, with the eight custom properties they read
resolved from a live gp-sphinx page in both themes.

MIT, Copyright (c) 2026 team git-pull. Same owner as this repository.

Vendored rather than reimplemented, deliberately. The reference here has to be
visually indistinguishable from gp-sphinx's, and a second stylesheet written
to look like the first is a copy that drifts on the first change to either.
Taking the rules verbatim means a divergence is a diff, not an opinion.

The selectors are the reason the reference emits `dl.py.<objtype>` / `dt.sig`
/ `dd`. That structure was not required — the brief left it open — but it is
what these rules match, and it is what docutils chose for a definition list
because a reference entry *is* one. Nested `div`s would have meant porting
1,652 lines by hand to gain nothing.

To refresh: re-read the two files above and re-resolve the tokens against a
built gp-sphinx page. `site/test/api-parity.test.ts` fails when they drift.
