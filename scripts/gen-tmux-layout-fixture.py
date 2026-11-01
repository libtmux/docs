#!/usr/bin/env python3
"""Regenerate the tmux-layout parity fixture from tmuxp's own Python module.

site/src/lib/tmux-layout.ts is a port of tmuxp's `docs/_ext/tmux_layout.py`.
The port is only as good as its agreement with that module, so
site/test/fixtures/tmux-layout-pygments.json holds what the module (and the
Pygments it highlights with) produced for a fixed set of commands and layouts,
and site/test/tmux-layout.test.ts requires the port to reproduce it exactly.

Run this with an interpreter that has tmuxp's docs dependencies (docutils,
sphinx, Pygments), such as the checkout's own virtual environment:

    ~/work/python/tmuxp/.venv/bin/python scripts/gen-tmux-layout-fixture.py

Use --check to compare instead of write; it exits 1 when the committed fixture
differs from what the module produces now. The probes below are the single
list of commands the port is held to: add one here, regenerate, and the test
picks it up. The test also fails when a lexer rule no probe reaches.
"""

from __future__ import annotations

import argparse
import importlib.util
import itertools
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "site/test/fixtures/tmux-layout-pygments.json"
MODULE = "docs/_ext/tmux_layout.py"

# Commands the docs show, then probes for each lexer rule and for the places
# Python's `re` and JavaScript's `RegExp` read text differently.
COMMANDS = [
    "echo 'did you know'",
    "echo 'you can inline'",
    "cd /var/log",
    "ls -al | grep \\.log",
    "echo hello",
    "cd ~/",
    "pwd",
    'echo "$ENV"',
    "# a note",
    "echo <a>",
    "export FOO=bar",
    "cd $HOME/src && ls",
    "tail -F /var/log/syslog",
    'echo "___$((1 + 3))___"',
    "./manage.py runserver 0.0.0.0:${SERVER_PORT}",
    "FOO=1 make -j4",
    "top",
    "man echo",
    "git status --short",
    "echo $(date)",
    "echo `date`",
    "for i in 1 2; do echo $i; done",
    "if true; then echo x; fi",
    "echo foo > out.txt",
    "cat <<EOF",
    "python3 -c 'print(1)'",
    "ls -al *.log",
    "echo a;echo b",
    "sleep 2",
    "cd ~/work && pytest -q",
    "watch -n 1 date",
    "tmux -L x ls",
    "echo \"it's\" 'q\"q'",
    "echo $'a\\n'",
    "echo \\.log",
    "echo a\\ b",
    "export PS1='> '",
    "echo ${HOME:-/tmp}/x",
    "echo $((0x1f + 2#101))",
    'echo "unterminated',
    "echo 'unterminated",
    "echo $",
    "echo $1 $? $$",
    "a=1 b=2 cmd",
    "x+=y",
    'echo "a $(date) b"',
    'echo "${A}"',
    "echo ü",
    "echo a #c",
    "echo a\\",
    "!!",
    "[ -f x ] && echo y",
    "echo {a,b}",
    "cat <<<'hi'",
    "echo \"<a href='x'>&amp;</a>\"",
    "exec zsh -l",
    "tail -f log | grep -E 'err|warn' > /dev/null 2>&1 &",
    "",
    # Rules the lines above leave unreached: a shebang, a here-document that
    # closes, a colon in an expansion, a base marker with no digits after it,
    # and a name inside arithmetic.
    "#!/bin/sh",
    "#!/usr/bin/env bash -eu",
    "cat <<EOF\nhi\nEOF",
    "cat <<-'END'\n\tbody\nEND",
    "cat <<\\STOP\n$x\nSTOP",
    "echo ${x:}",
    "echo ${x:1:2}",
    "echo ${x:+set} ${#y} ${z:-$(date)}",
    "echo $((2#))",
    "echo $((x + y * 3))",
    "echo $(( n ** 2 ))",
    "echo $((16#ff + 8#7))",
    "echo $(echo `date`)",
    "echo `echo $(date)`",
    "echo `unterminated",
    # Python reads \w, \d, \s, \b and . as Unicode; the port must as well.
    # Word characters: letters, digits and numbers of any script, but not marks.
    "echo ü=1",
    "ü=1 cmd",
    "export ñame=bar",
    "ifü",
    "doné",
    "if\u0663",
    "for²",
    "echo $ü",
    "echo ${ü}",
    "echo $x²y",
    "echo $x\u0301",
    "echo ${x²}",
    "echo e\u0301",
    "echo ²",
    "echo ½",
    "echo Ⅷ",
    "Ⅷ=1 cmd",
    "echo \U0001d49c=1",
    "\U0001d49c=1 cmd",
    "echo ${\U0001d49c}",
    "cat <<ü\nx\nü",
    # Digits: Unicode decimal digits only, and \d+\b needs a word edge after.
    "echo \uff11\uff12",
    "echo 12٣",
    "echo \U0001d7d9\U0001d7da",
    "echo \U0001d7d9x",
    "echo 1²",
    "echo 12é",
    "echo 12\u0301",
    "echo $٣",
    "echo $((٣ + ٤))",
    "echo $((\uff11 + \uff12))",
    "echo $((2#é))",
    # Whitespace: Python adds U+001C-U+001F and U+0085 to JavaScript's set and
    # leaves out U+FEFF.
    "echo a\u3000b",
    "echo\u00a0two",
    "echo naïve café",
    "echo\x1cx",
    "echo\x85x",
    "if\x85true",
    "echo\x0bx\x0cy",
    "echo\u00a0x",
    "echo\ufeffx",
    "x\ufeff=1",
    "echo \u200bx",
    "cat <<\u00a0EOF\nx\nEOF",
    "cat <<\u2003EOF\nx\nEOF",
    # The dot stops at \n only; JavaScript's also stops at U+2028 and U+2029.
    "# a\u2028b",
    "# a\u2029b",
    "#!/bin/sh\u2028x",
    "# 🎉 note",
    # Astral characters stay whole.
    'echo "日本語 $x"',
    "echo 'emoji 🎉' 🎉",
    "echo x\u2028y",
    # Line endings and a byte-order mark, which Pygments normalises first.
    "echo a\rb",
    "echo a\r\nb",
    "echo a\r\r\nb",
    "\r\n#!/bin/sh\r\necho x",
    "\ufeffecho hi",
    "\ufeff#!/bin/sh",
    "\ufeff\ufeffecho hi",
    "\n\ufeffecho hi",
    "\n\necho padded\n\n",
]

# Layout, panes and screen size: every arrangement, with a count that shows how
# the last row of a tiled grid spans the screen.
CASES = [
    (
        "even-vertical",
        [
            ["echo 'did you know'", "echo 'you can inline'"],
            ["echo 'single commands'"],
            ["echo 'for panes'"],
        ],
        (36, 12),
    ),
    ("even-vertical", [["echo hello"], ["echo hello"]], (30, 10)),
    (
        "main-horizontal",
        [["cd /var/log", "ls -al | grep \\.log"], ["echo hello"], ["echo hello"]],
        (44, 12),
    ),
    (
        "main-vertical",
        [["cd /var/log", "ls -al | grep \\.log"], ["echo hello"], ["echo hello"]],
        (44, 12),
    ),
    (
        "tiled",
        [["cd /var/log", "ls -al | grep \\.log"], ["echo hello"], ["echo hello"], ["echo hello"]],
        (44, 12),
    ),
    ("tiled", [["a"], ["b"], ["c"]], (30, 12)),
    ("tiled", [["a"], ["b"], ["c"], ["d"], ["e"]], (50, 15)),
    ("even-horizontal", [["x"], ["y"], ["z"]], (50, 13)),
    ("main-vertical", [["x"], ["y"], ["z"], ["w"]], (47, 13)),
    ("main-horizontal", [["x"], ["y"], ["z"], ["w"], ["v"]], (47, 13)),
    (
        "tiled",
        [["cd /var/log", "ls -al | grep \\.log"], ["echo hello"], ["echo hello"], ["echo hello"]],
        (30, 12),
    ),
    ("even-vertical", [["echo ü $x", "echo 'a < b' && ls"], ["cat <<EOF"]], (36, 10)),
]


def load_module(tmuxp: Path):
    """Import tmuxp's directive module by path."""
    path = tmuxp / MODULE
    spec = importlib.util.spec_from_file_location("tmux_layout", path)
    if spec is None or spec.loader is None:
        sys.exit(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def provenance(tmuxp: Path) -> str:
    """Name the module revision and the Pygments that produced the data."""
    import pygments

    def git(*args: str) -> str:
        done = subprocess.run(
            ["git", "-C", str(tmuxp), *args, "--", MODULE],
            capture_output=True,
            text=True,
            check=True,
        )
        return done.stdout.strip()

    if git("status", "--porcelain"):
        sys.exit(f"{tmuxp / MODULE} has uncommitted changes, so no commit names its output")
    sha = git("log", "-1", "--format=%H")
    return (
        f"tmuxp {MODULE} at {sha}, run under Pygments {pygments.__version__}; "
        "every svg is rendered with its first diagram id"
    )


def build(tmuxp: Path) -> dict:
    """Return what the module produces for every probe and every case."""
    module = load_module(tmuxp)
    render = []
    for layout, panes, size in CASES:
        module._SVG_IDS = itertools.count(1)
        render.append(
            {
                "layout": layout,
                "panes": panes,
                "size": list(size),
                "svg": module.render_layout(panes, layout, size),
            }
        )
    return {
        "source": provenance(tmuxp),
        "highlight": {command: module._highlight(command) for command in COMMANDS},
        "render": render,
    }


def main() -> int:
    """Write the fixture, or compare it with the module's output under ``--check``."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--tmuxp", type=Path, default=Path.home() / "work/python/tmuxp", help="tmuxp checkout"
    )
    parser.add_argument("--output", type=Path, default=FIXTURE, help="fixture to write or compare")
    parser.add_argument("--check", action="store_true", help="compare instead of write")
    args = parser.parse_args()

    text = json.dumps(build(args.tmuxp), indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if args.output.read_text(encoding="utf-8") != text:
            print(f"{args.output} differs from what tmuxp's module produces", file=sys.stderr)
            return 1
        return 0
    args.output.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
