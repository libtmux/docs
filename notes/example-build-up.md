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

## Check a page against a port's trunk

The cache binds a page to the revision in the port's API model. The port's own
docs build reads its trunk instead, so an anchor that resolves here can stop
resolving there, and the port's build fails with `to anchor "..." matches no
line`. Resolve every `file=` fence of the port against the revision its build
will read:

```console
$ node scripts/check-example-blocks.mjs \
    --port go \
    --checkout /path/to/libtmux-go \
    --revision origin/master
```

The command reads committed bytes with `git show`, so the checkout's branch and
working tree do not matter. It covers excerpts and whole-file inclusions on
every content page, names each fence that fails, and exits 1. An unknown port
or revision exits 2. `check-example-blocks.negative.mjs` builds a port whose
later revision drops the line an anchor names, and requires the failure beside
a clean pass at the first revision.

## Landing page excerpts

A port's version root (`/<port>/latest/`) offers Core API, MCP and Workspace
Manager, each with a tested example. Core API shows the homepage program for
the port. MCP and Workspace Manager show an excerpt of a program the port's
own CI runs, named in `site/src/data/landing-examples.json`:

```json
{
  "ts": {
    "mcp": {
      "file": "examples/mcp-agent/mcp-agent.ts",
      "lang": "typescript",
      "from": "export async function connectAgent",
      "to": "=}",
      "ci": {
        "workflow": ".github/workflows/typescript.yml",
        "command": "bun run typecheck && bun run test"
      }
    }
  }
}
```

`file`, `from` and `to` follow the excerpt fences above, against the file at the
revision the port's API model records for that product. A workspace example
shows its configuration and the code that builds it, which a file may keep far
apart: `more` lists further ranges of the same file in file order, and the page
separates the ranges with a blank line. Each range must be a whole unit.

`ci` names the workflow and the command in one of its `run` steps that reaches
the file. A test reads the workflow at that revision and requires the command
there, with continued lines joined; a comment, a step name or an environment
value that spells the command does not count. A port that
serves a product with another port's package has no entry of its own:
PowerShell's MCP is the .NET tool, so its panel quotes the C# entry.

A product that ships without such a program is recorded as
`{ "missing": "<reason>" }`. Its panel keeps the install widget and shows no
example. A test requires every shipped product to have one entry or the other,
and lists the gaps by name.

Regenerate the cache after changing an entry or a model revision. Python's
workspace manager and MCP server are read from the `tmuxp` and `libtmux-mcp`
checkouts, set with `LIBTMUX_DOCS_WORKSPACE_PY` and `LIBTMUX_DOCS_MCP_PY`;
point `LIBTMUX_DOCS_CHECKOUT_<PORT>` at a checkout that holds the revision for
any other port whose `-docs` worktree is absent:

```console
$ node scripts/gen-example-sources.mjs
```

`scripts/check-example-blocks.mjs` fails when an excerpt matches no line, matches
several, or ends inside a block. Its `--port` mode resolves the excerpts held
in that port's repository against the revision it names.

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

6. Resolve the page against the port's trunk with the command above.
7. Run the native example for the page again if its displayed bytes changed.
