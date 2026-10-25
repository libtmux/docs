#!/usr/bin/env python3
"""Print the exact Erlang/OTP and Elixir versions a libtmux-elixir checkout pins.

Usage: read-elixir-toolchain.py SOURCE_DIRECTORY

.tool-versions pins release lines, so the exact pair comes from the source's
support policy (priv/tmux/support.json), and .tool-versions must select it.
Appends otp-version and elixir-version to the file named by GITHUB_OUTPUT.
Nothing is written when a version is missing, inexact or not selected.
"""

import json
import os
import pathlib
import re
import sys

PATTERNS = {'erlang': r'[0-9]+\.[0-9]+(?:\.[0-9]+){0,2}', 'elixir': r'[0-9]+\.[0-9]+\.[0-9]+'}


def read(source: pathlib.Path) -> dict[str, str]:
    reference = json.loads((source / 'priv/tmux/support.json').read_text())['reference']
    selected = {'erlang': reference.get('otp'), 'elixir': reference.get('elixir')}
    for tool, version in selected.items():
        if not isinstance(version, str) or not re.fullmatch(PATTERNS[tool], version):
            raise ValueError(f'elixir: selected source must pin an exact {tool} version')
    lines = [line.split() for line in (source / '.tool-versions').read_text().splitlines()]
    for tool, version in selected.items():
        selectors = [line for line in lines if line and line[0] == tool]
        if len(selectors) != 1 or len(selectors[0]) != 2 or not (
                version == selectors[0][1] or version.startswith(selectors[0][1] + '.')):
            raise ValueError(f'elixir: .tool-versions must select the pinned {tool} {version}')
    return selected


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    selected = read(pathlib.Path(sys.argv[1]))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f"otp-version={selected['erlang']}\n")
        output.write(f"elixir-version={selected['elixir']}\n")


if __name__ == '__main__':
    main()
