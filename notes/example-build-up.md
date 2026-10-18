# Building an example page up to its program

An example page teaches the program it ends with. It opens with a short
concept paragraph, adds one call per numbered step, and ends with the
complete program. The native tmux pages under `site/src/content/docs/examples/`
and the Go pages under `site/src/content/docs/ports/go/examples/` are the
reference; copy their shape.

## Page shape

1. One paragraph on the concept and what the program does. Say that each
   step block is a range of lines from the complete program.
2. Steps as `## 1. Verb the thing` headings. Each step names one call or
   idea in plain words, shows one small block, and says what to observe.
3. `## The complete program` with the tested file, exactly as the native run
   records it.
4. The run command and its output, then the links the page already had.

A step that uses a tmux command names it in inline code, so the mention
pipeline links and badges it: `send-keys`, `#{pane_id}`, `exit-empty`. Write
keys in tmux notation (`C-c`, the `Enter` key). Link the guide or concept page
the step relies on. In a port page, name the tmux command behind each call and
link the API symbol with its qualified name, such as `Pane.SendKeys` or
`SendKeysRequest.SkipEnter`; a bare `Command` links to nothing. Link the
native step that builds the same sequence in shell as
`/tmux/examples/<page>/#<step>`: on a port page, a bare `/examples/` link
stays in that port and can point at the page itself.

Keep the old section anchors as `<a id="...">` lines above the step that took
over their content.

## Step blocks are excerpts

A step block is an empty fence that names its source and two lines:

````markdown
```go excerpt="main.go" from="server.NewSession" to="=  }"
```
````

- `excerpt="<title>"` quotes the page's own block with that `title`, which
  the native run hashes. `file="<path>"` quotes a file in the port's
  revision-bound example cache instead. Neither needs a marker in the port.
- `from` is text on the first line and must match exactly one line.
- `to` is text on the last line; the first match after `from` ends the range.
  Start the text with `=` to match a whole line, indentation included, such
  as `=  }` for a closing brace at two spaces or `=\t}` at one tab.
- A value that holds double quotes uses single quotes around it:
  `from='"$found" != yes'`.
- Shared indentation is removed.

The build fails, naming the page, when `from` matches no line or several,
when `to` is missing or only above `from`, or when the source block is
missing or duplicated. A fence that names an excerpt and carries its own
text is replaced by the excerpt; `scripts/check-example-blocks.mjs` fails
on it for the pages that check scans. The
Markdown and LLM exports carry the quoted lines, without the anchors.

Choose each range to be a whole unit: a statement, an `if` with its closing
line, a loop with its `done`. The check rejects a range with unbalanced
braces, parentheses, `if`/`fi` or `do`/`done`, which is how a `to` that
matched an earlier closing line shows itself.

## What the page may show

`scripts/check-example-blocks.mjs` fails when a block on an example page is
none of these:

- an excerpt that resolves to a whole unit,
- a whole cached file written as `file="<path>"`,
- a file whose `title` and bytes a recorded run holds,
- a `console` command the recorded run lists,
- or a `text` block whose lines the recorded run must print.

The record is the example's entry in `site/test/fixtures/*-examples.json`,
which `scripts/check-example-prose.py` runs. A page without an entry can show
only excerpts of a cached file. `check-example-blocks.negative.mjs` plants a
hand-typed block and other defects, and requires a clean copy to pass.

## Converting a port

1. Pick the tested source: the displayed `main.*` that the page's native run
   records, or the example file the port's own tests run, which the cache
   holds.
2. Write the steps in call order. Put cleanup last in the steps even when the
   file registers it first, and say so in the complete-program paragraph.
3. Link symbols with qualified names, run
   `node scripts/check-api-links.mjs <page>`, and fix any mention that
   resolves to nothing.
4. Add the port to `BUILT_UP_PORTS` in `scripts/check-example-blocks.mjs`.
5. Stage the Ruby and Lua guides, then regenerate the "Discussed in" index:

   ```console
   $ node scripts/stage-port-docs.mjs --integrated
   ```

   ```console
   $ node scripts/gen-mentions.mjs
   ```

6. Run the native example for the page again if its displayed bytes changed.
