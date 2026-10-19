# tmux catalog: options, hooks and format variables

Prose across the site names tmux options (`destroy-unattached`), hooks
(`session-created`) and format variables (`session_attached`) that the
CLI Manual and the C source reference do not index. The catalog is a browser
for those names, built from the same data tmux uses, so any page can link to
the entry for the tmux release it describes.

## Entry kinds

| Kind | Fields | Source in the tmux tree |
| ---- | ------ | ----------------------- |
| `option` | scope (`server`, `session`, `window`, `pane`), type, default, minimum, maximum, unit, choices, array and style flags, accepted spellings | A row of `options_table[]` in `options-table.c`; choice lists, symbolic defaults and ranges resolve through the same file and `tmux.h`. |
| `hook` | scope, the command an `after-` hook follows, control mode notification of the same name, firing sites | `OPTIONS_TABLE_*HOOK` rows of `options_table[]`; firing sites are the literal names passed to `notify_*` and `cmdq_insert_hook` in `*.c`. |
| `format` | type (`string` or `time`), the object it describes, short form, callback | `format_table[]` in `format.c`, plus names the manual documents that are set elsewhere (`format_add`, `cmdq_add_format`, `%s_suffix` patterns). The object is the first `ft->` member the callback reads. |

Descriptions come from the tmux.1 of the same release: the `OPTIONS` list, the
`HOOKS` list (a hook without its own text falls back to its `%name` entry in
`CONTROL MODE`, and an `after-` hook to the shared after-hook paragraph) and
the `Variable name` tables. An option the manual omits keeps the `.text` from
the option table and says so. A format variable the manual omits is listed as
undocumented rather than dropped.

Other tables would justify more kinds (control mode notifications, layouts,
key tables). They are not part of this change.

## Extraction

`scripts/gen-tmux-catalog.mjs` reads the pinned commit of each release in
`site/src/data/tmux/versions.json` and writes
`site/src/data/tmux/catalog/<version>.json`. Output is sorted and
deterministic. Every entry carries `file:line` at that commit.

The script refuses to guess: an unresolved symbol in a table cell, a format
variable with no source location, or a manual snapshot whose `manualSha256`
differs from `tmux.1` at the commit stops the run. `--check` verifies digests
and shape without a checkout, and with `--source` regenerates and compares.
`gen-tmux-catalog.negative.mjs` shows each failure.

## Pages and URLs

```text
/tmux/<version>/catalog/                      index
/tmux/<version>/catalog/options/              kind page, grouped like the tree
/tmux/<version>/catalog/options/<name>/       entry page
/tmux/<version>/catalog/hooks/<name>/
/tmux/<version>/catalog/formats/<name>/
/tmux/<version>/catalog/tree.json             sidebar tree and search inventory
/tmux/<version>/catalog/<kind>/<name>.preview.json
```

`<version>` is a pinned release or `latest`. The page uses the C reference's
layout: a sidebar tree with search and All, Options, Hooks and Formats tabs, kind
badges, and an entry page with facts, description, releases, source and
"Used by". A name missing from another release links that release's section.

The picker and the tmux sidebar list it as "Options, hooks and formats", a
third section beside "CLI Manual" and "C source reference".

## Linking

`tmuxEntityHref(kind, name, version)` in `site/src/lib/tmux-links.ts` is the one
place a tmux name becomes a destination. A command resolves to its CLI Manual
page; an option, hook or format variable resolves to its catalog entry, and an
entry page links back to the manual text through `tmuxManualEntityHref`.
`tmuxMentions` finds the names in a run of text, and every surface uses it: API
docstrings (`ApiDoc`), guides and topics (`rehype-api-links`), their Markdown
exports (`prose-markdown`, `symbol-markdown`) and the CLI Manual HTML
(`tmux-catalog-html.ts`). Hover cards for catalog links come from
`<entry>.preview.json`.

Which options, hooks and variables count as a mention is decided in
`tmux-catalog-links.ts`, in this order:

1. Only code literals link. Prose names an entry without being a reference to
   it.
2. A language API link wins. A name the library documents as its own symbol
   links there; the catalog link is the fallback, and a command claims a span
   that holds one.
3. A whole literal links, quoted or not, with an array index
   (`after-new-window[0]`). A hyphenated option or hook links as a separate word
   of a longer run, and an underscored variable links inside `#{...}`.
4. A single word (`status`, `host`) links only beside the word `option`, `hook`
   or `variable`, as the argument of `set-option`, `set-hook` and their read
   forms, or as `#{word}`. A name more than one kind uses, or a command's name,
   links only when a neighbouring word picks the kind; otherwise it stays plain.
5. Inside `#{...}` only the variable position links (after `#{`, `#{?` or
   `E:`, `T:`, `t:` and similar); words after a comparison stay literal.
6. Displayed examples, flags (`--status-left`), control notifications
   (`%session-renamed`), user options (`@name`) and paths never link.
7. A name absent from the selected release stays plain.

Library members that wrap a family (`set_hook`, `show_hooks`, `Hooks`) link to
the matching catalog section through the concepts in
`packages/api-model/src/concepts.ts` and the wrapper types listed in
`tmux-catalog.ts`. An entry page lists, per port, the members whose
documentation names it, and a C declaration (`options_table`, `format_cb_*`,
`notify_*`) links to its catalog entries.

## Open questions

- The URL plural (`options`, `hooks`, `formats`) against the singular used for
  kinds in code.
- Whether single-word names should ever link without a context word.
