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

## Programming-language artwork

The homepage language selector uses local copies of the following artwork
to identify the selected language. Each source record includes the download
URL, retrieval time, file hash, copyright information and usage terms.
These marks identify their respective languages and do not imply endorsement
of libtmux.

The SVG files are copied unchanged except for Scala, whose empty surrounding
canvas is cropped. Its paths, gradients and colors are preserved, and the
original SVG is retained beside the cropped copy. Rust's supplied SVG includes
its own dark-theme colors.

| Language | Credit and terms | Local source record |
|---|---|---|
| Python | Python Software Foundation. The [PSF logo terms](https://www.python.org/psf/trademarks/) permit the unaltered mark to identify Python. | [Python provenance](/brand/languages/py/provenance.json) |
| Ruby | Copyright © 2006, Yukihiro Matsumoto. The [Ruby logo](https://www.ruby-lang.org/en/about/logo/) is licensed under [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/). | [Ruby provenance](/brand/languages/ruby/provenance.json) |
| Lua | Copyright © 1998 Lua.org; graphic design by Alexandre Nakonechnyj. The Devicon copy carries its [MIT notice](/brand/languages/lua/LICENSE.txt); [Lua's logo terms](https://www.lua.org/images/) also apply. Visit [Lua.org](https://www.lua.org/). | [Lua provenance](/brand/languages/lua/provenance.json) |
| TypeScript | Microsoft. The [official branding terms](https://www.typescriptlang.org/branding/) govern the mark; the website repository licenses exclude logo and trademark rights. | [TypeScript provenance](/brand/languages/ts/provenance.json) |
| Rust | The Rust Foundation. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and the [Rust trademark policy](https://rustfoundation.org/policy/rust-trademark-policy/) apply. | [Rust provenance](/brand/languages/rs/provenance.json) |
| Go | The [Go gopher](https://go.dev/blog/gopher) is by Renee French, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). | [Go provenance](/brand/languages/go/provenance.json) |
| C++ | Created by Jeremy Kratz and licensed by the Standard C++ Foundation under its [logo-use terms](https://isocpp.org/home/terms-of-use). | [C++ provenance](/brand/languages/cxx/provenance.json) |
| Swift | Apple Inc., under the [Swift Logo Guidelines](https://developer.apple.com/swift/downloads/swift-logo.zip). Swift and the Swift logo are trademarks of Apple Inc. | [Swift provenance](/brand/languages/swift/provenance.json) |
| Java | Devicon collection copyright (c) 2015 konpa, with its [MIT notice](/brand/languages/java/LICENSE.txt). This does not establish unrestricted rights to the underlying Java logo; [Oracle's logo terms](https://www.oracle.com/legal/logos/) apply. | [Java provenance](/brand/languages/java/provenance.json) |
| Kotlin | Kotlin Foundation brand guidelines preserve JetBrains copyrights. The [icon-use terms](https://kotlinfoundation.org/guidelines/) permit identifying Kotlin alongside other programming-language icons. | [Kotlin provenance](/brand/languages/kotlin/provenance.json) |
| Scala | Copyright EPFL. [Historical permission](https://groups.google.com/g/scala-user/c/bCC-R0FQn1w) covers noncommercial Scala promotion; the [general artwork-license question](https://github.com/scala/scala-lang/issues/1040) remains unresolved. | [Scala provenance](/brand/languages/scala/provenance.json) |
| C# | Copyright the .NET authors. [Brand-use permission](https://github.com/dotnet/brand/issues/10#issuecomment-669465301) allows the unmodified logo to represent .NET. The repository's CC0 statement covers illustrations; no blanket CC0 claim is made for the logo. | [.NET provenance](/brand/languages/csharp/provenance.json) |
| F# | The F# Software Foundation. Its [logo terms](https://foundation.fsharp.org/logo) require unchanged shape, colors and proportions, without implying Foundation representation. | [F# provenance](/brand/languages/fsharp/provenance.json) |

## Terminal artwork

The tmux CLI selector displays the Windows Terminal artwork by Microsoft
Corporation, licensed under [CC BY-ND 4.0](https://creativecommons.org/licenses/by-nd/4.0/).
The SVG is unmodified. See the [source and provenance](/brand/tools/terminal/provenance.json)
and [copyright and license](/brand/tools/terminal/LICENSE.txt).

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
