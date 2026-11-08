#!/usr/bin/env python3
"""Read exact GHC and Cabal pins from the selected source for documentation CI."""

from __future__ import annotations

import os
import pathlib
import re
import sys


def read(source: pathlib.Path) -> dict[str, str]:
    """Validate both versions before returning any GitHub Actions output values."""
    lines = [line.split() for line in (source / ".tool-versions").read_text().splitlines()]
    selected = {}
    for tool, pattern in {
        "ghc": r"[0-9]+\.[0-9]+\.[0-9]+",
        "cabal": r"[0-9]+(?:\.[0-9]+){3}",
    }.items():
        pins = [line for line in lines if line and line[0] == tool]
        if len(pins) != 1 or len(pins[0]) != 2 or not re.fullmatch(pattern, pins[0][1]):
            message = f"haskell: selected source must pin an exact, unique {tool} version"
            raise ValueError(message)
        selected[tool] = pins[0][1]
    return selected


def main() -> None:
    """Append validated versions; missing, moving and duplicate pins write nothing."""
    if len(sys.argv) != 2:
        message = "Usage: read-haskell-toolchain.py SOURCE_DIRECTORY"
        raise SystemExit(message)
    selected = read(pathlib.Path(sys.argv[1]))
    with pathlib.Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"ghc-version={selected['ghc']}\n")
        output.write(f"cabal-version={selected['cabal']}\n")


if __name__ == "__main__":
    main()
