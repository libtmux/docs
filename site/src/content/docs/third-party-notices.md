---
title: Third-party notices
description: Thanks to tmux's creator and contributors, with licences and attribution for the software behind libtmux.org.
sidebar:
  label: Third-party notices
  order: 99
tableOfContents: true
---

## tmux

First and foremost, thank you to **[Nicholas Marriott (nicm)](https://github.com/nicm)**,
the creator of tmux, and to the many
[tmux contributors](https://github.com/tmux/tmux/graphs/contributors).
We are grateful for the work that makes tmux possible.

libtmux is a separate project. Our libraries and supporting tools control a
real tmux server; tmux itself provides the terminal multiplexer. This is the
libtmux website. Visit the [official tmux website](https://github.com/tmux/tmux/wiki)
for the upstream project and its documentation.

See tmux's [COPYING file](https://github.com/tmux/tmux/blob/master/COPYING)
and the copyright and permission notices in its source files for its licensing.

### tmux artwork

The tmux logomark is by Jason Long. The site uses the unmodified
[upstream SVG](https://github.com/tmux/tmux/blob/8f25579c5aef8d93924a20681f394e2a582fd3ad/logo/tmux-logomark.svg)
under its [copyright and permission notice](/brand/tmux/LICENSE.txt).

## Documentation toolchain

libtmux and this site are built with open-source software. The following
tools have their own licences and attribution requirements.

| Tool | Licence | Role |
|---|---|---|
| [Astro](https://astro.build) | MIT | The site shell |
| [Tailwind CSS](https://tailwindcss.com) | MIT | Styling |
| [Pagefind](https://pagefind.app) | MIT | Site-wide search |
| [Expressive Code](https://expressive-code.com) | MIT | Code blocks |
| [Sphinx](https://www.sphinx-doc.org) | BSD-2-Clause | Python and C++ reference |
| [Furo](https://github.com/pradyunsg/furo) | MIT | Sphinx theme |
| [Breathe](https://github.com/breathe-doc/breathe) | BSD-3-Clause | Doxygen XML into Sphinx |
| [Doxygen](https://www.doxygen.nl) | GPL-2.0-only | Parses C++ headers to XML |
| [API Extractor](https://api-extractor.com) | MIT | TypeScript API model |
| [IBM Plex](https://github.com/IBM/plex) | OFL-1.1 | Typeface |

### A note on Doxygen

Doxygen is licensed GPL-2.0-only. It runs as a build step that reads libtmux's
own headers and emits XML; that XML is rendered by Breathe and Sphinx, and no
Doxygen-generated HTML is published. Running a GPL program over your own input
does not place its licence on the output, and libtmux does not distribute
Doxygen or any modified version of it.

## Reference hosting

The [PyPI blocks logo](https://pypi.org/trademarks/) is a trademark of the
Python Software Foundation and identifies links to the Python Package Index.
Other package-host icons use [Simple Icons](https://simpleicons.org/)
(CC0-1.0).

Three ports deep-link to the canonical host their ecosystem already uses,
rather than duplicating it here:

- Rust: [docs.rs](https://docs.rs/libtmux)
- Go: [pkg.go.dev](https://pkg.go.dev/github.com/libtmux/libtmux-go/tmux)
- Java and Kotlin: [javadoc.io](https://javadoc.io/doc/io.github.libtmux/libtmux)

Those sites are operated independently of this project and carry their own
terms.

## libtmux itself

Each port is MIT licensed. See the `LICENSE` file in that port's repository
for the authoritative text.
