# One API model, eight languages

## Why this exists

libtmux.org renders eight ports of the same library. Each one's reference
currently comes from its own native generator — Sphinx+autodoc, api-extractor,
`docfx --outputFormat markdown`, Doxygen→Breathe→Sphinx — which means four
visual styles, four sets of anchor conventions, and no way to link
`Pane.capture_pane` in Python to `Pane.capture` in Rust.

The target style is the one `gp-sphinx` already produces for libtmux-python:
a signature line, kind and modifier badges, parameter/return/raises field
lists, and a permalink per symbol. This package produces the model that style
needs, from source, for every language.

## What tree-sitter can and cannot do

Tree-sitter parses. It does not resolve. That boundary is not a limitation to
work around; it is the thing to design against, and measuring it was the first
real result here.

Running the Python extractor over `libtmux/pane.py` and diffing against the
page gp-sphinx publishes for the same module:

| | count |
|---|---|
| Members gp-sphinx renders | 251 |
| Members this extractor finds in the file | 56 |

The 195 it does not find are not bugs in the parse. They fall into two groups,
and only one of them is a real gap:

**Policy, not capability.** `_refresh`, `_show_option`, `__init__` and friends
are in the file and deliberately skipped — autodoc shows them because
libtmux's `conf.py` passes `:private-members:`. That is a flag, not a
mechanism.

**The real gap: inherited members.** `active_window_index`,
`bracket_paste_flag`, `buffer_name` and ~180 siblings are dataclass fields on
`Obj` in `libtmux/neo.py`, generated from tmux's format tokens. They are not
in `pane.py` at any level of parsing, because they are not *in* `pane.py`.
autodoc sees them because it imports `Pane` and walks the resolved MRO of a
live class object.

The answer is not a type checker. It is a **project-level pass**: parse every
file into one symbol table, then resolve `class Pane(Obj)` by looking `Obj` up
in that table and inheriting its members. That is name matching over a known
set, which is exactly the shape tree-sitter supports, and it is how the rest
of the languages will need to work too — Rust's `impl` blocks and Swift's
extensions attach members to a type declared elsewhere in the same way.

### Result

That pass closes the gap completely. Extracting `~/work/python/libtmux/src`
with `privateMembers` and `specialMembers` on, and diffing `Pane`'s members
against every `id="libtmux.Pane.*"` anchor gp-sphinx emits:

| | count |
|---|---|
| gp-sphinx anchors | 251 |
| Extracted members | 257 |
| **In gp-sphinx, missing here** | **0** |

The six extras are all explained. Five are dunders — `__enter__`, `__eq__`,
`__exit__`, `__getitem__`, `__repr__` — which libtmux's `conf.py` does not
list in `:special-members:`; a flag, and arguably one the site should keep on.
The sixth, `client_utf8`, *is* rendered by gp-sphinx: it appears on the page
with a signature but no `id` anchor, because the name reaches `Pane` twice
through the MRO and Sphinx anchors only the first. So the real comparison is
257 against 252, and every difference is a deliberate visibility choice.

2,024 symbols across the whole package: 1,311 attributes, 416 methods, 96
constants, 73 functions, 62 properties, 36 classes, 30 exceptions.

### Inheritance is resolved depth-first, not by C3

Python's real MRO is C3 linearisation. This walks bases depth-first with a
visited set instead, because the question documentation asks is "does this
name reach here", not "which implementation wins" — and the two answers differ
only for a diamond where both branches define the same name, which then
renders the same signature either way. The visited set is not optional: a
diamond would otherwise copy shared members twice, and a cycle — which invalid
source can express — would not terminate. A member declared on the subclass
always beats an inherited one, so an override renders its own docstring.

What stays out of reach without a per-language type checker, and is therefore
out of scope by decision rather than by omission:

- Resolving `t.Literal["-"] | int | None` to anything but its own text. The
  model stores annotations verbatim; the renderer cross-links them by matching
  names against the symbol table, and leaves unmatched names as plain text.
- Generic instantiation: `list[Window]` links `Window`, not `list[Window]`.
- Conditional or dynamically-generated members. libtmux-python generates its
  format-token fields at runtime from a table; those reach the model only
  because the *table* is source we can read.

## Overloads

`capture_pane` is two `@t.overload` stubs and one implementation. A reference
that renders the first is wrong and looks right — the stubs have `...` bodies,
no docstring, and a narrower return type. They are merged onto one symbol with
three signatures; the documented one supplies the prose. Every other language
in scope has the same shape under a different spelling (TypeScript declaration
merging, C# method groups, C++ overload sets), so this is modelled once.

## Version pinning, and a failure worth writing down

`web-tree-sitter` must match the era its grammars were built in.
`tree-sitter-wasms` ships ABI 13-14; runtime **0.25.10 loads all eight**, and
0.26 and 0.27 both reject them. 0.27 does so by throwing a bare `Error` with
no message from inside `getDylinkMetadata`, which reads like a corrupt WASM
file rather than a version skew — an hour's debugging if you trust the
message. The dependency is pinned exactly, in the workspace catalog, with that
reason next to it.

Prebuilt WASM rather than building grammars here: `tree-sitter build --wasm`
wants emscripten or docker, which would make this package unusable on a
machine that only wants to render documentation. `tree-sitter-wasms` is
Unlicense, which satisfies the project's permissive-licensing constraint.

## Grammar coverage

All eight target languages have a maintained prebuilt grammar, including the
two that looked risky:

| Language | Grammar | ABI |
|---|---|---|
| Python | `tree-sitter-python` | 14 |
| TypeScript | `tree-sitter-typescript` | 14 |
| Rust | `tree-sitter-rust` | 14 |
| Go | `tree-sitter-go` | 14 |
| Java | `tree-sitter-java` | 14 |
| C# | `tree-sitter-c_sharp` | 13 |
| C++ | `tree-sitter-cpp` | 14 |
| Swift | `tree-sitter-swift` | 13 |

---

## Front end: tree-sitter for six ports, native symbol graphs for two

A peer research session challenged the whole tree-sitter foundation, with
numbers. The challenge was largely right, and the reason it gave was not quite
the right one — both worth recording, because a wrong reason leads to a wrong
fix later.

**The claim.** "Swift has no published WASM grammar; don't build on
web-tree-sitter." The first half is false as stated: `tree-sitter-wasms` ships
`tree-sitter-swift.wasm`, it loads under the pinned runtime, and this package
parses Swift with it today. The npm package `tree-sitter-swift` indeed ships
native prebuilds only — that is a different package.

**What actually disqualifies it.** Parse *quality*, measured here over the real
trees rather than accepted from the report:

| Language | Files with parse errors | Bytes lost |
|---|---|---|
| Python | 0 / 33 | 0.00% |
| Rust | 15 / 202 | 0.01% |
| C++ | 25 / 31 | 0.34% |
| Swift | **50 / 91** | **2.84%** |

The peer's independent sweep over a wider corpus found the same shape — Java,
C#, Python, Go, Rust and TypeScript at 0.00%, C++ and Swift the outliers — and
identified the causes: Swift's `func f() async throws(TmuxError) -> R` (typed
throws) and `switch try await g()`, which parse individually and fail in
combination; C++'s `LIBTMUX_NAMESPACE_BEGIN`, a macro that opens a namespace,
which no parser without a preprocessor can balance.

The C++ residual is the one that settles it for documentation specifically:
`void f(std::string s = {})` yields a MISSING node and the default argument is
lost. An API reference exists to show default arguments.

**The decision.** The front end is per-port and pragmatic; the model and the
renderer are not.

| Port | Extractor | Why |
|---|---|---|
| Python, TypeScript, Rust, Go, Java, C# | tree-sitter | 0.00–0.01% loss, one runtime, no compiler in the docs build |
| C++ | Doxygen XML | already generated in this project's build, structured, and a real preprocessor |
| Swift | `swift build -emit-symbol-graph` | 762 symbols with `preciseIdentifier` cross-references already resolved; parses typed throws by construction |

This costs less than it looks. The pain this project set out to fix was eight
pipelines producing four *visual styles*; the extractors were never the pain.
Collapsing eight renderers into one is the win, and that win lives entirely in
the model and the renderer — which are identical whichever front end feeds
them. Nothing built so far is invalidated by this: the Python extractor, the
symbol table, the linker and the components all sit above the line.

**Adopted from the same exchange:** SCIP's symbol descriptor grammar
(`pkg/module/Class#method().`) is a deterministic, language-independent id
scheme, which is exactly the cross-language permalink this site needs and is
worth reusing rather than reinventing. Its *indexers* are a separate question
and, measured on libtmux-ts, currently emit `signature_documentation: 0`,
`display_name: ""` and `kind: 0` — the fields a renderer would read are empty
and the types arrive as a markdown hover blob. So: adopt the schema, not the
toolchain.
