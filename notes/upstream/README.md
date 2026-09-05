# Upstream defects found while building this site

Three bugs in projects this site consumes, found by extracting all eight
ports through one pipeline and then checking that every link it produced
lands somewhere. Each is fixed on a branch; none has been filed or sent
upstream — that is a separate decision.

The pattern in all three is the same, and it is the reason this
directory exists: **a build that reports success is not evidence that
the output is right.** Doxygen exited zero on a tree it had extracted no
prose from. Sphinx rendered an unresolved `:meth:` as plain text.
sphinx-gp-llms wrote a link to a file it had decided not to write. Only
reading the output caught any of them.

| Note | Project | Fixed on |
|---|---|---|
| [C++ comments invisible to Doxygen](libtmux-cxx-doxygen-comments.md) | libtmux-cxx | `tony/libtmux-cxx` `docs/doxygen-comment-style` + `docs-site` |
| [Pane exception inherits WindowError](libtmux-python-pane-exception.md) | libtmux (Python) | `tony/libtmux-python` `fix/pane-exception-base` |
| [.md twin linked but never written](sphinx-gp-llms-md-twins.md) | sphinx-gp-llms | local branch only — the repo is public and has no private fork |

Two of the three are now caught by this repo's own checks:
`scripts/check-links.mjs` reports the `genindex.md` 404 on every
assembly, and the C++ documentation gap shows as an empty
`briefdescription` count.
