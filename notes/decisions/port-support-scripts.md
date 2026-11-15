# Port support scripts: kept for real use, written in the port's language

Decided 2026-11-15 by the maintainer. Each port states this policy in its own
`.github/SCRIPTS.md`, linked from `AGENTS.md`, and tracks its cleanup in one
issue.

## The problem

A read-only scan of the 18 ports' trunks on 2026-11-15 found support scripts
that no longer earn their place:

- Harnesses that compare a port with Python libtmux, or with tmuxp, run in CI
  or gate releases. Perl, TypeScript, C++, .NET, Java, Swift, Rust and Go each
  carry at least one; several CI jobs clone Python libtmux or install tmuxp
  only to feed them.
- Scripts with no caller, kept after the work that used them merged.
- Scripting-language ports run their tooling in Python: Lua carries about 65
  Python files, Julia 14, Perl 10.
- Copies of one script drift apart: `apt-get.sh` is byte-identical in 13
  repositories, and about 45 near-duplicate tmux build and resolve files
  repeat across ports.
- Examples and tests start, prepare or stop tmux with shell commands because
  the port's own API cannot yet.

## The decision

A port keeps a script only when the project runs it for a current reason: a
CI job, a release step, a code generator, a documentation check, or a
maintainer task named in the port's contributing guide. Everything else goes.

- **Parity is not a reason.** Delete harnesses, oracles, ledgers and fixtures
  whose purpose is agreement with Python libtmux or tmuxp, and the CI steps
  that install them. A port's tests check the port against tmux.
- **Shell setup marks a missing API.** When an example or test needs a shell
  step to create, prepare or stop tmux state, file an issue for the missing
  operation in that port, and remove the step when the operation lands.
  Examples own their server through the library.
- **No caller, no script.** Delete unreferenced and superseded scripts.
- **One home for shared tooling.** A script several ports need lives once, as
  a shared workflow or action, and ports call it. CI environment setup, such as
  installing packages, belongs in workflow steps or that shared action, not in
  a vendored script.

## Language

A scripting-language port writes its scripts in its own language, run by the
interpreter its CI already uses:

| Port | Scripts in | Port | Scripts in |
| ---- | ---------- | ---- | ---------- |
| ruby | Ruby | julia | Julia |
| lua | Lua (LuaJIT) | elixir | Elixir (`.exs`) |
| perl | Perl | erlang | Erlang (`escript`) |
| raku | Raku | powershell | PowerShell |
| ts | TypeScript on Bun | lisp | Common Lisp (`sbcl --script`) |

A compiled-language port (cxx, rs, go, java, dotnet, swift, haskell, ocaml)
writes its scripts in Python. The library has no Python dependency, so a
small typed Python script costs less than a second build system for tooling.

## Layout and checks

- A script with its own tests lives in `scripts/<name>/`: the script,
  `README.md` (what it does, who runs it, how to run it) and `tests/`. A short
  single-purpose script may be one file with a usage header.
- In a scripting-language port, scripts pass the same formatter, linter, type
  checker and test runner as the library, in CI.
- In a compiled-language port, scripts declare their dependencies inline
  (PEP 723), run with `uv run`, and pass `ruff format`, `ruff check`,
  `ty check` and `pytest`, with `pytest-asyncio` for async code and doctests
  collected, in CI.
- Use the current idioms of the language and its tooling; no shims for
  interpreters below the project's floor.
- Before a new or rewritten script merges, a reviewer who did not write it
  checks it against the port's writing guide and
  [no-ai-slop](https://github.com/petergyang/no-ai-slop).

## What stays

- GitHub Actions `run:` lines that call one command.
- Tools a language cannot provide without a third-party build step may use a
  test-only dependency in the port's language (for example `IO::Pty` in Perl,
  NativeCall in Raku), never a second language.
- Test data that is not a comparison, such as workspace YAML files a port's
  loader reads.
