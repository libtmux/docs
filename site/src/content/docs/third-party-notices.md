---
title: Third-party notices
description: Licences and attribution for the tools that build libtmux.org and the software libtmux depends on.
sidebar:
  label: Third-party notices
  order: 99
tableOfContents: true
---

libtmux and this site are built with open-source software. Several of those
licences ask that their notice text travel with the work, so it is reproduced
here.

## Documentation toolchain

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

Three ports deep-link to the canonical host their ecosystem already uses,
rather than duplicating it here:

- Rust — [docs.rs](https://docs.rs/libtmux)
- Go — [pkg.go.dev](https://pkg.go.dev/github.com/libtmux/libtmux-go/tmux)
- Java and Kotlin — [javadoc.io](https://javadoc.io/doc/io.github.libtmux/libtmux)

Those sites are operated independently of this project and carry their own
terms.

## libtmux itself

Each port is MIT licensed. See the `LICENSE` file in that port's repository
for the authoritative text.
