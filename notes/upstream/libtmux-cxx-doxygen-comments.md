# Every briefdescription in the Doxygen XML is empty

The published API reference carries no prose for any symbol, because
Doxygen does not read the comment style the headers use.

## What happens

`include/` has 31 headers holding 1,105 comments, all written as plain
`//`. Doxygen treats those as ordinary source comments: a documentation
comment has to be `///`, `//!`, `/**` or `/*!`. There are zero of those
in the tree.

The result is visible in the generated XML:

```console
$ rg -c '^\s*(///|/\*\*)' include/**/*.hpp | paste -sd+ | bc
0
$ python3 -c "
import re, glob
tot = empty = 0
for f in glob.glob('xml/*.xml'):
    for m in re.finditer(r'<briefdescription>(.*?)</briefdescription>', open(f).read(), re.S):
        tot += 1
        empty += not m.group(1).strip()
print(tot, empty)"
995 995
```

995 `<briefdescription>` elements, 995 of them empty. Anything consuming
the XML — Breathe, Sphinx, or a custom generator — gets structure with no
descriptions.

## Example

`include/libtmux/entities.hpp:260`:

```cpp
  // Exec-order arguments; empty after this value is moved from.
  std::vector<std::string> argv;
```

That sentence is real documentation and it does not appear anywhere in
`xml/`.

## Fixing it

Doxygen has no setting that promotes plain `//` to a documentation
comment — `MULTILINE_CPP_IS_BRIEF` and `JAVADOC_AUTOBRIEF` both change
how recognised comments are split, not which comments are recognised. So
the comments themselves have to change:

```diff
-  // Exec-order arguments; empty after this value is moved from.
+  /// Exec-order arguments; empty after this value is moved from.
   std::vector<std::string> argv;
```

A mechanical pass over declarations in `include/` covers the 995
elements above; comments inside function bodies can stay as they are.

`EXTRACT_ALL = NO` interacts with this: with it off, entities that end
up undocumented are omitted from the XML entirely, so the two settings
are worth deciding together.

## Why this is worth reporting

The headers are already documented. The prose exists, was written
deliberately, and is thrown away by the toolchain rather than missing.

---

## Status

Fixed, not filed. Nothing was posted to any public repo.

- `tony/libtmux-cxx` branch `docs/doxygen-comment-style` — 913 comment
  lines in 260 blocks converted from `//` to `///` across 25 headers.
  The diff is comments only; `g++ -fsyntax-only` is clean.
- `tony/libtmux-cxx` branch `docs-site` — `JAVADOC_AUTOBRIEF = YES` in
  the Doxyfile, without which a multi-line `///` block becomes the
  detailed description and the brief stays empty.

Measured on the converted tree: **0 -> 261 brief descriptions** in the
generated XML, and 155 detailed. Doxygen warnings dropped from 7 to 4;
the remaining 4 are pre-existing `std::hash` specialisation notices that
want `BUILTIN_STL_SUPPORT`, unrelated to comments.

Not upstreamed. Sending it to `libtmux/libtmux-cxx` is a decision for
you — it touches 25 files and the maintainers may prefer their own pass.
